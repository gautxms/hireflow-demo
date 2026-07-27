import crypto from 'node:crypto'
import { pool, logErrorToDatabase } from '../db/client.js'
import { resolvePaddleConfig } from '../config/paddle.js'
import { inferPlanFromPaddlePayload } from './paddlePlanChangeRecovery.js'

const TERMINAL = new Set(['confirmed', 'already_satisfied', 'manual_required', 'superseded'])

export function isRecoveryBillingAdjustmentEnabled(environment, env = process.env) {
  const enabled = String(env.PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS || '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  return enabled.includes(environment)
}

function validDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function selectAuthoritativeCapture(payments = []) {
  return payments
    .filter((payment) => String(payment?.status).toLowerCase() === 'captured' && validDate(payment?.captured_at))
    .sort((left, right) => {
      const time = new Date(right.captured_at) - new Date(left.captured_at)
      return time || String(right.id || '').localeCompare(String(left.id || ''))
    })[0] || null
}

export function addBillingInterval(capturedAt, plan) {
  const source = validDate(capturedAt)
  if (!source || !['monthly', 'annual'].includes(plan)) return null
  const year = source.getUTCFullYear()
  const month = source.getUTCMonth()
  const day = source.getUTCDate()
  const targetYear = plan === 'annual' ? year + 1 : year + Math.floor((month + 1) / 12)
  const targetMonth = plan === 'annual' ? month : (month + 1) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const result = new Date(source)
  result.setUTCFullYear(targetYear, targetMonth, Math.min(day, lastDay))
  return result
}

function transactionIsRecurringRenewal(transaction) {
  return transaction?.origin === 'subscription_recurring'
    && transaction?.status === 'completed'
    && Boolean(transaction?.subscription_id)
    && Number(transaction?.details?.totals?.grand_total ?? transaction?.details?.totals?.total ?? 0) > 0
}

async function paddleRequest(paddle, path, options = {}) {
  const response = await fetch(`${paddle.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${paddle.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': paddle.apiVersion,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error('Paddle recovery billing adjustment request failed')
    error.status = response.status
    error.providerCode = payload?.error?.code || null
    throw error
  }
  return payload?.data || payload
}

export async function createRecoveryAdjustmentForAttempt(attempt, dependencies = {}) {
  const db = dependencies.db || pool
  const paddle = dependencies.paddle || resolvePaddleConfig(process.env, attempt.paddle_environment)
  if (!isRecoveryBillingAdjustmentEnabled(paddle.environment, dependencies.env || process.env)) return null

  const transaction = await (dependencies.getTransaction
    ? dependencies.getTransaction(attempt.transaction_id)
    : paddleRequest(paddle, `/transactions/${encodeURIComponent(attempt.transaction_id)}`))
  const capture = selectAuthoritativeCapture(transaction?.payments)
  const userResult = await db.query(
    `SELECT id, subscription_status, subscription_plan, paddle_environment, paddle_customer_id,
            paddle_subscription_id, cancellation_effective_at, last_paddle_event_at
     FROM users WHERE id = $1`, [attempt.user_id],
  )
  const user = userResult.rows[0]
  const subscription = await (dependencies.getSubscription
    ? dependencies.getSubscription(transaction?.subscription_id)
    : paddleRequest(paddle, `/subscriptions/${encodeURIComponent(transaction?.subscription_id || '')}`))
  const plan = inferPlanFromPaddlePayload(subscription, paddle)
  const safe = user && transactionIsRecurringRenewal(transaction) && capture
    && attempt.transaction_id === transaction.id
    && attempt.paddle_environment === paddle.environment
    && user.paddle_environment === paddle.environment
    && transaction.customer_id === user.paddle_customer_id
    && transaction.subscription_id === user.paddle_subscription_id
    && subscription.id === user.paddle_subscription_id
    && subscription.customer_id === user.paddle_customer_id
    && subscription.status === 'active'
    && plan === user.subscription_plan
    && !user.cancellation_effective_at
    && !subscription.scheduled_change
  const currentNext = validDate(subscription?.next_billed_at)
  const target = addBillingInterval(capture?.captured_at, plan)
  if (!safe || !currentNext || !target) {
    console.warn('[recovery-billing-adjustment] ownership/security rejection', {
      userId: attempt.user_id, environment: paddle.environment, reasonCode: 'ineligible_recovery',
    })
    return null
  }

  const result = await db.query(
    `INSERT INTO recovery_billing_adjustments (
       user_id, paddle_environment, paddle_customer_id, paddle_subscription_id,
       recovery_transaction_id, captured_at, previous_next_billed_at, target_next_billed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (paddle_environment, recovery_transaction_id) DO NOTHING RETURNING *`,
    [user.id, paddle.environment, user.paddle_customer_id, user.paddle_subscription_id,
      transaction.id, capture.captured_at, currentNext, target],
  )
  if (result.rows[0]) console.info('[recovery-billing-adjustment] created', { adjustmentId: result.rows[0].id, userId: user.id, environment: paddle.environment })
  return result.rows[0] || null
}

function stableIdempotencyKey(adjustment) {
  return crypto.createHash('sha256').update(`recovery-billing-adjustment:${adjustment.id}`).digest('hex')
}

export async function processRecoveryAdjustment(adjustment, dependencies = {}) {
  if (!adjustment || TERMINAL.has(adjustment.status)) return adjustment?.status || null
  const db = dependencies.db || pool
  const paddle = dependencies.paddle || resolvePaddleConfig(process.env, adjustment.paddle_environment)
  const getSubscription = dependencies.getSubscription
    || ((id) => paddleRequest(paddle, `/subscriptions/${encodeURIComponent(id)}`))
  let subscription
  try {
    subscription = await getSubscription(adjustment.paddle_subscription_id)
    const target = validDate(adjustment.target_next_billed_at)
    const current = validDate(subscription?.next_billed_at)
    const plan = inferPlanFromPaddlePayload(subscription, paddle)
    if (!target || !current || target <= new Date() || subscription.id !== adjustment.paddle_subscription_id
      || subscription.customer_id !== adjustment.paddle_customer_id || subscription.status !== 'active'
      || plan !== adjustment.subscription_plan && adjustment.subscription_plan
      || subscription.scheduled_change) {
      await db.query(`UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='lifecycle_changed', updated_at=NOW() WHERE id=$1`, [adjustment.id])
      return 'superseded'
    }
    if (current < target) {
      console.info('[recovery-billing-adjustment] provider update attempted', { adjustmentId: adjustment.id, userId: adjustment.user_id, environment: paddle.environment })
      const patch = dependencies.patchSubscription || ((id, body, key) => paddleRequest(paddle, `/subscriptions/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body),
      }))
      await patch(adjustment.paddle_subscription_id, {
        next_billed_at: target.toISOString(), proration_billing_mode: 'do_not_bill',
      }, stableIdempotencyKey(adjustment))
      subscription = await getSubscription(adjustment.paddle_subscription_id)
    }
    const confirmed = validDate(subscription?.next_billed_at)
    if (!confirmed || confirmed < target || subscription.status !== 'active'
      || subscription.id !== adjustment.paddle_subscription_id || subscription.customer_id !== adjustment.paddle_customer_id) {
      throw Object.assign(new Error('Provider state did not confirm target'), { providerCode: 'verification_failed' })
    }
    const status = current >= target ? 'already_satisfied' : 'confirmed'
    await db.query('BEGIN')
    const userUpdate = await db.query(
      `UPDATE users SET current_period_end=$2, subscription_renewal_date=$2, next_billing_date=$2,
         quota_anchor_at=$3, updated_at=NOW()
       WHERE id=$1 AND subscription_status='active' AND paddle_subscription_id=$4
         AND paddle_customer_id=$5 AND subscription_plan=$6
         AND COALESCE(NULLIF(LOWER(paddle_environment),''),'production')=$7
         AND cancellation_effective_at IS NULL RETURNING id`,
      [adjustment.user_id, confirmed, adjustment.captured_at, adjustment.paddle_subscription_id,
        adjustment.paddle_customer_id, plan, paddle.environment],
    )
    if (userUpdate.rowCount !== 1) throw Object.assign(new Error('Local lifecycle changed'), { providerCode: 'local_cas_conflict' })
    await db.query(
      `UPDATE recovery_billing_adjustments SET status=$2, provider_confirmed_next_billed_at=$3,
         confirmed_at=NOW(), updated_at=NOW(), safe_error_code=NULL WHERE id=$1 AND status NOT IN ('superseded','manual_required')`,
      [adjustment.id, status, confirmed],
    )
    await db.query('COMMIT')
    console.info(`[recovery-billing-adjustment] ${status}`, { adjustmentId: adjustment.id, userId: adjustment.user_id, environment: paddle.environment })
    return status
  } catch (error) {
    try { await db.query('ROLLBACK') } catch { /* no open transaction */ }
    const code = String(error.providerCode || '')
    const manual = error.status === 422 && /billing|30_minute|too_close/i.test(code)
    const status = manual ? 'manual_required' : 'retryable_failed'
    await db.query(
      `UPDATE recovery_billing_adjustments SET status=$2, attempt_count=attempt_count+1,
         next_retry_at=CASE WHEN $2='retryable_failed' THEN NOW()+INTERVAL '15 minutes' ELSE NULL END,
         safe_error_code=$3, updated_at=NOW() WHERE id=$1`,
      [adjustment.id, status, manual ? 'next_billing_within_30_minutes' : (code || `provider_${error.status || 'unknown'}`)],
    )
    await logErrorToDatabase('recovery_billing_adjustment.failed', error, { adjustmentId: adjustment.id, userId: adjustment.user_id, environment: paddle.environment, status })
    return status
  }
}

export async function runRecoveryBillingAdjustments() {
  const candidates = await pool.query(
    `SELECT pa.* FROM payment_attempts pa JOIN users u ON u.id=pa.user_id
     WHERE pa.status='succeeded' AND pa.transaction_id IS NOT NULL
       AND COALESCE(pa.metadata->>'resolved_by','') <> ''
       AND NOT EXISTS (SELECT 1 FROM recovery_billing_adjustments a
         WHERE a.paddle_environment=pa.paddle_environment AND a.recovery_transaction_id=pa.transaction_id)
     ORDER BY pa.updated_at DESC LIMIT 20`,
  )
  for (const attempt of candidates.rows) await createRecoveryAdjustmentForAttempt(attempt)
  const due = await pool.query(
    `SELECT a.*, u.subscription_plan FROM recovery_billing_adjustments a JOIN users u ON u.id=a.user_id
     WHERE a.status='pending' OR (a.status='retryable_failed' AND a.next_retry_at<=NOW())
     ORDER BY a.created_at LIMIT 20`,
  )
  for (const adjustment of due.rows) await processRecoveryAdjustment(adjustment)
  return candidates.rowCount + due.rowCount
}
