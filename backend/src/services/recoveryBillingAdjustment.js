import crypto from 'node:crypto'
import { pool, logErrorToDatabase } from '../db/client.js'
import { resolvePaddleConfig } from '../config/paddle.js'
import { inferPlanFromPaddlePayload } from './paddlePlanChangeRecovery.js'

const TERMINAL = new Set(['confirmed', 'already_satisfied', 'manual_required', 'superseded'])
const MISSING_CAPTURE_MAX_ATTEMPTS = 4

function enabledEnvironments(env) {
  return [...new Set(String(env.PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS || '')
    .split(',').map((value) => value.trim().toLowerCase())
    .filter((value) => ['sandbox', 'production'].includes(value)))]
}

function normalizedEnvironment(value) {
  return String(value || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production'
}

export function isRecoveryBillingAdjustmentEnabled(environment, env = process.env) {
  return enabledEnvironments(env).includes(environment)
}

function validDate(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
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

function transactionHasRecurringIdentity(transaction) {
  return transaction?.origin === 'subscription_recurring'
    && Boolean(transaction?.subscription_id)
    && Number(transaction?.details?.totals?.grand_total ?? transaction?.details?.totals?.total ?? 0) > 0
}

function transactionMatchesPlan(transaction, paddle, plan) {
  const expectedInterval = plan === 'annual' ? 'year' : 'month'
  const items = Array.isArray(transaction?.items) ? transaction.items : []
  return inferPlanFromPaddlePayload(transaction, paddle) === plan
    && items.some((item) => {
      const interval = item?.price?.billing_cycle?.interval || item?.price?.billingCycle?.interval
      return inferPlanFromPaddlePayload({ items: [item] }, paddle) === plan
        && interval === expectedInterval
        && Number(item?.quantity ?? 1) > 0
    })
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

async function markAttemptPermanentlyIneligible(db, attempt, reasonCode) {
  await db.query(
    `UPDATE payment_attempts SET metadata=COALESCE(metadata, '{}'::jsonb)
       || jsonb_build_object('recovery_adjustment_ineligible', $2::text), updated_at=NOW()
     WHERE id=$1`,
    [attempt.id, reasonCode],
  )
}

async function scheduleAttemptDiscoveryRetry(db, attempt, reasonCode) {
  await db.query(
    `UPDATE payment_attempts SET metadata=COALESCE(metadata, '{}'::jsonb)
       || jsonb_build_object(
         'recovery_adjustment_discovery_status', 'retryable_failed',
         'recovery_adjustment_discovery_error_code', $2::text,
         'recovery_adjustment_discovery_retry_at', NOW()+INTERVAL '15 minutes'
       ), updated_at=NOW()
     WHERE id=$1`,
    [attempt.id, reasonCode],
  )
}

function isPermanentTransactionLookupFailure(error) {
  return [404, 410].includes(Number(error?.status))
}

async function recordMissingCapture(db, attempt) {
  return db.query(
    `WITH capture_retry AS (
       SELECT CASE
         WHEN COALESCE(metadata->>'recovery_adjustment_capture_attempts', '') ~ '^[0-9]+$'
           THEN (metadata->>'recovery_adjustment_capture_attempts')::integer
         ELSE 0
       END + 1 AS attempt_count
       FROM payment_attempts
       WHERE id=$1
       FOR UPDATE
     )
     UPDATE payment_attempts pa
     SET metadata=COALESCE(pa.metadata, '{}'::jsonb) || jsonb_build_object(
           'recovery_adjustment_capture_attempts', capture_retry.attempt_count,
           'recovery_adjustment_capture_status',
             CASE WHEN capture_retry.attempt_count >= $2 THEN 'manual_required' ELSE 'retryable_failed' END,
           'recovery_adjustment_capture_error_code', 'missing_trustworthy_capture',
           'recovery_adjustment_discovery_retry_at', NOW()+INTERVAL '15 minutes'
         ),
         updated_at=NOW()
     FROM capture_retry
     WHERE pa.id=$1
     RETURNING metadata->>'recovery_adjustment_capture_status' AS status`,
    [attempt.id, MISSING_CAPTURE_MAX_ATTEMPTS],
  )
}

export async function createRecoveryAdjustmentForAttempt(attempt, dependencies = {}) {
  const db = dependencies.db || pool
  const paddle = dependencies.paddle || resolvePaddleConfig(process.env, attempt.paddle_environment)
  if (!isRecoveryBillingAdjustmentEnabled(paddle.environment, dependencies.env || process.env)) return null

  let transaction
  try {
    transaction = await (dependencies.getTransaction
      ? dependencies.getTransaction(attempt.transaction_id)
      : paddleRequest(paddle, `/transactions/${encodeURIComponent(attempt.transaction_id)}`))
  } catch (error) {
    if (isPermanentTransactionLookupFailure(error)) {
      await markAttemptPermanentlyIneligible(db, attempt, 'provider_transaction_unavailable')
      console.warn('[recovery-billing-adjustment] ownership/security rejection', {
        userId: attempt.user_id, environment: paddle.environment, reasonCode: 'provider_transaction_unavailable',
      })
      return null
    }
    await scheduleAttemptDiscoveryRetry(db, attempt, `provider_transaction_${error?.status || 'unavailable'}`)
    throw error
  }
  const capture = selectAuthoritativeCapture(transaction?.payments)
  const userResult = await db.query(
    `SELECT id, subscription_status, subscription_plan, paddle_environment, paddle_customer_id,
            paddle_subscription_id, cancellation_effective_at, last_paddle_event_at
     FROM users WHERE id = $1`, [attempt.user_id],
  )
  const user = userResult.rows[0]
  const transactionIdentityValid = transactionHasRecurringIdentity(transaction)
    && transaction.id === attempt.transaction_id
    && normalizedEnvironment(attempt.paddle_environment) === paddle.environment
  if (!transactionIdentityValid || !user) {
    await markAttemptPermanentlyIneligible(db, attempt, 'invalid_provider_identity')
    return null
  }
  if (transaction.status !== 'completed') {
    await scheduleAttemptDiscoveryRetry(db, attempt, 'provider_transaction_not_completed')
    return null
  }
  if (!capture) {
    const captureState = await recordMissingCapture(db, attempt)
    const status = captureState.rows[0]?.status || 'retryable_failed'
    console.warn(`[recovery-billing-adjustment] ${status === 'manual_required' ? 'manual intervention required' : 'capture retry scheduled'}`, {
      userId: attempt.user_id, environment: paddle.environment, attemptId: attempt.id,
      reasonCode: 'missing_trustworthy_capture',
    })
    return null
  }
  if (transaction.customer_id !== user.paddle_customer_id
    || transaction.subscription_id !== user.paddle_subscription_id) {
    await markAttemptPermanentlyIneligible(db, attempt, 'subscription_ownership_mismatch')
    return null
  }
  if (normalizedEnvironment(user.paddle_environment) !== paddle.environment) {
    await markAttemptPermanentlyIneligible(db, attempt, 'environment_ownership_mismatch')
    return null
  }
  if (user.cancellation_effective_at || ['canceled', 'cancelled'].includes(String(user.subscription_status).toLowerCase())) {
    await markAttemptPermanentlyIneligible(db, attempt, 'subscription_finally_cancelled')
    return null
  }
  let subscription
  try {
    subscription = await (dependencies.getSubscription
      ? dependencies.getSubscription(transaction?.subscription_id)
      : paddleRequest(paddle, `/subscriptions/${encodeURIComponent(transaction?.subscription_id || '')}`))
  } catch (error) {
    if (isPermanentTransactionLookupFailure(error)) {
      await markAttemptPermanentlyIneligible(db, attempt, 'provider_subscription_unavailable')
      return null
    }
    await scheduleAttemptDiscoveryRetry(db, attempt, `provider_subscription_${error?.status || 'unavailable'}`)
    throw error
  }
  const plan = inferPlanFromPaddlePayload(subscription, paddle)
  const permanentlyIncompatible = subscription.id !== user.paddle_subscription_id
    || subscription.customer_id !== user.paddle_customer_id
    || plan !== user.subscription_plan
    || !transactionMatchesPlan(transaction, paddle, user.subscription_plan)
    || Boolean(subscription.scheduled_change)
    || ['canceled', 'cancelled'].includes(String(subscription.status).toLowerCase())
  if (permanentlyIncompatible) {
    await markAttemptPermanentlyIneligible(db, attempt, 'subscription_lifecycle_incompatible')
    return null
  }
  if (subscription.status !== 'active') {
    await scheduleAttemptDiscoveryRetry(db, attempt, 'subscription_not_active')
    return null
  }
  const safe = user && transactionIsRecurringRenewal(transaction) && capture
    && transactionMatchesPlan(transaction, paddle, plan)
    && attempt.transaction_id === transaction.id
    && normalizedEnvironment(attempt.paddle_environment) === paddle.environment
    && normalizedEnvironment(user.paddle_environment) === paddle.environment
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
    await scheduleAttemptDiscoveryRetry(db, attempt, 'provider_state_not_ready')
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

function subscriptionMatchesAdjustment(subscription, adjustment, paddle, plan) {
  return subscription?.id === adjustment.paddle_subscription_id
    && subscription?.customer_id === adjustment.paddle_customer_id
    && subscription?.status === 'active'
    && !subscription?.scheduled_change
    && inferPlanFromPaddlePayload(subscription, paddle) === plan
}

function followingRenewalExists(transactions, recoveryTransaction, adjustment, paddle) {
  const recoveryTime = validDate(recoveryTransaction?.created_at) || validDate(adjustment.captured_at)
  return transactions.some((transaction) => {
    const createdAt = validDate(transaction?.created_at)
    return transaction?.id !== recoveryTransaction.id
      && transaction?.origin === 'subscription_recurring'
      && transaction?.subscription_id === adjustment.paddle_subscription_id
      && transaction?.customer_id === adjustment.paddle_customer_id
      && transactionMatchesPlan(transaction, paddle, adjustment.subscription_plan)
      && !['canceled', 'cancelled'].includes(String(transaction?.status).toLowerCase())
      && createdAt && recoveryTime && createdAt > recoveryTime
  })
}

async function classifyLocalRace(db, adjustment, confirmed, plan, paddle) {
  const result = await db.query(
    `SELECT a.status, u.subscription_status, u.subscription_plan, u.paddle_customer_id,
            u.paddle_subscription_id, u.paddle_environment, u.cancellation_effective_at,
            u.current_period_end, u.subscription_renewal_date, u.next_billing_date, u.quota_anchor_at,
            u.last_paddle_event_at
     FROM recovery_billing_adjustments a JOIN users u ON u.id=a.user_id
     WHERE a.id=$1`,
    [adjustment.id],
  )
  const state = result.rows[0]
  if (TERMINAL.has(state?.status)) return state.status
  const lifecycleMatches = state?.subscription_status === 'active'
    && state.subscription_plan === plan
    && state.paddle_customer_id === adjustment.paddle_customer_id
    && state.paddle_subscription_id === adjustment.paddle_subscription_id
    && String(state.paddle_environment || 'production').toLowerCase() === paddle.environment
    && !state.cancellation_effective_at
  if (!lifecycleMatches) {
    await db.query(
      `UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='lifecycle_changed',
         next_retry_at=NULL, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
      [adjustment.id],
    )
    return 'superseded'
  }
  if (validDate(state.quota_anchor_at) > validDate(adjustment.captured_at)) {
    await db.query(
      `UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='newer_recovery_applied',
         next_retry_at=NULL, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
      [adjustment.id],
    )
    return 'superseded'
  }
  const observedEventAt = validDate(adjustment.observed_last_paddle_event_at)
  const currentEventAt = validDate(state.last_paddle_event_at)
  const providerEventChanged = observedEventAt?.getTime() !== currentEventAt?.getTime()
  const confirmedAt = validDate(confirmed)
  const newerBillingProjection = [
    state.current_period_end,
    state.subscription_renewal_date,
    state.next_billing_date,
  ].some((value) => validDate(value) > confirmedAt)
  if (providerEventChanged && newerBillingProjection) {
    await db.query(
      `UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='newer_provider_event',
         next_retry_at=NULL, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
      [adjustment.id],
    )
    return 'superseded'
  }
  const sameInstant = (value, expected) => validDate(value)?.getTime() === validDate(expected)?.getTime()
  if (sameInstant(state.current_period_end, confirmed)
    && sameInstant(state.subscription_renewal_date, confirmed)
    && sameInstant(state.next_billing_date, confirmed)
    && sameInstant(state.quota_anchor_at, adjustment.captured_at)) {
    const healed = await db.query(
      `UPDATE recovery_billing_adjustments SET status='confirmed', provider_confirmed_next_billed_at=$2,
         confirmed_at=NOW(), next_retry_at=NULL, safe_error_code=NULL, updated_at=NOW()
       WHERE id=$1 AND status='provider_updating'`,
      [adjustment.id, confirmed],
    )
    return healed.rowCount === 1 ? 'confirmed' : 'conflict'
  }
  return 'conflict'
}

export async function processRecoveryAdjustment(adjustment, dependencies = {}) {
  if (!adjustment || TERMINAL.has(adjustment.status)) return adjustment?.status || null
  const db = dependencies.db || pool
  const paddle = dependencies.paddle || resolvePaddleConfig(process.env, adjustment.paddle_environment)
  const getSubscription = dependencies.getSubscription
    || ((id) => paddleRequest(paddle, `/subscriptions/${encodeURIComponent(id)}`))
  const getTransaction = dependencies.getTransaction
    || ((id) => paddleRequest(paddle, `/transactions/${encodeURIComponent(id)}`))
  const listTransactions = dependencies.listTransactions || (dependencies.getTransaction
    ? async () => []
    : async (subscriptionId, customerId) => paddleRequest(
      paddle,
      `/transactions?subscription_id=${encodeURIComponent(subscriptionId)}&customer_id=${encodeURIComponent(customerId)}&per_page=30`,
    ))
  let transactionClient = null
  let transactionStarted = false
  let subscription
  try {
    const transaction = await getTransaction(adjustment.recovery_transaction_id)
    subscription = await getSubscription(adjustment.paddle_subscription_id)
    const target = validDate(adjustment.target_next_billed_at)
    const current = validDate(subscription?.next_billed_at)
    const previous = validDate(adjustment.previous_next_billed_at)
    const plan = inferPlanFromPaddlePayload(subscription, paddle)
    const capture = selectAuthoritativeCapture(transaction?.payments)
    if (!target || !current || target <= new Date() || !transactionIsRecurringRenewal(transaction)
      || transaction.id !== adjustment.recovery_transaction_id
      || transaction.customer_id !== adjustment.paddle_customer_id
      || transaction.subscription_id !== adjustment.paddle_subscription_id
      || !capture || validDate(capture.captured_at)?.getTime() !== validDate(adjustment.captured_at)?.getTime()
      || !transactionMatchesPlan(transaction, paddle, adjustment.subscription_plan)
      || subscription.id !== adjustment.paddle_subscription_id
      || subscription.customer_id !== adjustment.paddle_customer_id || subscription.status !== 'active'
      || plan !== adjustment.subscription_plan && adjustment.subscription_plan
      || subscription.scheduled_change) {
      await db.query(`UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='lifecycle_changed', updated_at=NOW() WHERE id=$1 AND status='provider_updating'`, [adjustment.id])
      return 'superseded'
    }
    const relatedTransactions = await listTransactions(adjustment.paddle_subscription_id, adjustment.paddle_customer_id)
    if (followingRenewalExists(Array.isArray(relatedTransactions) ? relatedTransactions : [], transaction, adjustment, paddle)) {
      await db.query(
        `UPDATE recovery_billing_adjustments SET status='manual_required', safe_error_code='following_renewal_exists',
           next_retry_at=NULL, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
        [adjustment.id],
      )
      return 'manual_required'
    }
    if (current < target && (!previous || current.getTime() !== previous.getTime())) {
      await db.query(
        `UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='provider_billing_date_changed',
           next_retry_at=NULL, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
        [adjustment.id],
      )
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
    if (!subscriptionMatchesAdjustment(subscription, adjustment, paddle, plan)) {
      await db.query(
        `UPDATE recovery_billing_adjustments SET status='superseded', safe_error_code='lifecycle_changed',
           next_retry_at=NULL, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
        [adjustment.id],
      )
      return 'superseded'
    }
    if (!confirmed || confirmed < target) {
      throw Object.assign(new Error('Provider state did not confirm target'), { providerCode: 'verification_failed' })
    }
    const status = current >= target ? 'already_satisfied' : 'confirmed'
    transactionClient = typeof db.connect === 'function' ? await db.connect() : db
    await transactionClient.query('BEGIN')
    transactionStarted = true
    const userUpdate = await transactionClient.query(
      `UPDATE users SET current_period_end=$2, subscription_renewal_date=$2, next_billing_date=$2,
         quota_anchor_at=$3, updated_at=NOW()
       WHERE id=$1 AND subscription_status='active' AND paddle_subscription_id=$4
         AND paddle_customer_id=$5 AND subscription_plan=$6
         AND COALESCE(NULLIF(LOWER(paddle_environment),''),'production')=$7
         AND cancellation_effective_at IS NULL
         AND last_paddle_event_at IS NOT DISTINCT FROM $8::timestamptz
         AND current_period_end IS NOT DISTINCT FROM $9::timestamptz
         AND subscription_renewal_date IS NOT DISTINCT FROM $10::timestamptz
         AND next_billing_date IS NOT DISTINCT FROM $11::timestamptz
         AND (quota_anchor_at IS NULL OR quota_anchor_at <= $3) RETURNING id`,
      [adjustment.user_id, confirmed, adjustment.captured_at, adjustment.paddle_subscription_id,
        adjustment.paddle_customer_id, plan, paddle.environment,
        adjustment.observed_last_paddle_event_at || null,
        adjustment.observed_current_period_end || null,
        adjustment.observed_subscription_renewal_date || null,
        adjustment.observed_next_billing_date || null],
    )
    if (userUpdate.rowCount !== 1) {
      throw Object.assign(new Error('Local lifecycle changed'), { providerCode: 'local_cas_conflict', localRace: true })
    }
    const adjustmentUpdate = await transactionClient.query(
      `UPDATE recovery_billing_adjustments SET status=$2, provider_confirmed_next_billed_at=$3,
         confirmed_at=NOW(), updated_at=NOW(), safe_error_code=NULL
       WHERE id=$1 AND status='provider_updating'`,
      [adjustment.id, status, confirmed],
    )
    if (adjustmentUpdate.rowCount !== 1) {
      throw Object.assign(new Error('Adjustment claim lost'), { providerCode: 'adjustment_cas_conflict', localRace: true })
    }
    await transactionClient.query('COMMIT')
    transactionStarted = false
    console.info(`[recovery-billing-adjustment] ${status}`, { adjustmentId: adjustment.id, userId: adjustment.user_id, environment: paddle.environment })
    return status
  } catch (error) {
    if (transactionStarted) {
      try { await transactionClient.query('ROLLBACK') } catch { /* preserve the original failure */ }
      transactionStarted = false
    }
    transactionClient?.release?.()
    transactionClient = null
    if (error.localRace && subscription) {
      const raceStatus = await classifyLocalRace(db, adjustment, subscription.next_billed_at, adjustment.subscription_plan, paddle)
      if (raceStatus !== 'conflict') return raceStatus
    }
    const code = String(error.providerCode || '')
    const manual = error.status === 422 && /billing|30_minute|too_close/i.test(code)
    const status = manual ? 'manual_required' : 'retryable_failed'
    await db.query(
      `UPDATE recovery_billing_adjustments SET status=$2,
         next_retry_at=CASE WHEN $2='retryable_failed' THEN NOW()+INTERVAL '15 minutes' ELSE NULL END,
         safe_error_code=$3, updated_at=NOW() WHERE id=$1 AND status='provider_updating'`,
      [adjustment.id, status, manual ? 'next_billing_within_30_minutes' : (code || `provider_${error.status || 'unknown'}`)],
    )
    await (dependencies.logError || logErrorToDatabase)('recovery_billing_adjustment.failed', error, { adjustmentId: adjustment.id, userId: adjustment.user_id, environment: paddle.environment, status })
    return status
  } finally {
    transactionClient?.release?.()
  }
}

export async function runRecoveryBillingAdjustments(dependencies = {}) {
  const db = dependencies.db || pool
  const env = dependencies.env || process.env
  const createAdjustment = dependencies.createAdjustment || createRecoveryAdjustmentForAttempt
  const processAdjustment = dependencies.processAdjustment || processRecoveryAdjustment
  const enabled = enabledEnvironments(env)
  if (enabled.length === 0) return 0
  const candidates = await db.query(
    `SELECT pa.* FROM payment_attempts pa JOIN users u ON u.id=pa.user_id
     WHERE pa.status='succeeded' AND pa.transaction_id IS NOT NULL
       AND (
         COALESCE(pa.metadata->>'resolved_by','') IN ('webhook', 'automatic_retry', 'admin_retry')
         OR (
           pa.metadata->>'resolved_by' IN ('authoritative_reconciliation', 'subscription_get_reconciliation')
           AND pa.metadata->>'transaction_id' = pa.transaction_id
         )
       )
       AND COALESCE(pa.metadata->>'recovery_adjustment_ineligible','') = ''
       AND COALESCE(pa.metadata->>'recovery_adjustment_capture_status','') <> 'manual_required'
       AND (
         COALESCE(pa.metadata->>'recovery_adjustment_capture_status','') <> 'retryable_failed'
         OR pa.updated_at<=NOW()-INTERVAL '15 minutes'
       )
       AND (
         COALESCE(pa.metadata->>'recovery_adjustment_discovery_retry_at','') = ''
         OR (pa.metadata->>'recovery_adjustment_discovery_retry_at')::timestamptz<=NOW()
       )
       AND COALESCE(pa.payload->'data'->>'origin', pa.payload->>'origin','') = 'subscription_recurring'
       AND COALESCE(NULLIF(LOWER(pa.paddle_environment),''),'production') = ANY($1::text[])
       AND NOT EXISTS (SELECT 1 FROM recovery_billing_adjustments a
         WHERE COALESCE(NULLIF(LOWER(a.paddle_environment),''),'production')
             = COALESCE(NULLIF(LOWER(pa.paddle_environment),''),'production')
           AND a.recovery_transaction_id=pa.transaction_id)
     ORDER BY (pa.metadata->>'recovery_adjustment_discovery_retry_at')::timestamptz ASC NULLS FIRST,
              pa.updated_at DESC
     LIMIT 20`, [enabled],
  )
  for (const attempt of candidates.rows) {
    try {
      await createAdjustment(attempt, { ...dependencies, db, env })
    } catch (error) {
      await (dependencies.logError || logErrorToDatabase)('recovery_billing_adjustment.discovery_failed', error, { attemptId: attempt.id })
    }
  }
  const due = await db.query(
    `WITH claimable AS (
       SELECT a.id, u.subscription_plan,
              u.last_paddle_event_at AS observed_last_paddle_event_at,
              u.current_period_end AS observed_current_period_end,
              u.subscription_renewal_date AS observed_subscription_renewal_date,
              u.next_billing_date AS observed_next_billing_date
       FROM recovery_billing_adjustments a JOIN users u ON u.id=a.user_id
       WHERE a.paddle_environment = ANY($1::text[])
         AND (a.status='pending'
           OR (a.status='retryable_failed' AND a.next_retry_at<=NOW())
           OR (a.status='provider_updating' AND a.updated_at<=NOW()-INTERVAL '15 minutes'))
       ORDER BY a.captured_at DESC, a.created_at LIMIT 20 FOR UPDATE OF a SKIP LOCKED
     )
     UPDATE recovery_billing_adjustments a
     SET status='provider_updating', attempt_count=attempt_count+1, next_retry_at=NULL, updated_at=NOW()
     FROM claimable c WHERE a.id=c.id
     RETURNING a.*, c.subscription_plan, c.observed_last_paddle_event_at,
               c.observed_current_period_end, c.observed_subscription_renewal_date,
               c.observed_next_billing_date`, [enabled],
  )
  for (const adjustment of due.rows) {
    if (!isRecoveryBillingAdjustmentEnabled(adjustment.paddle_environment, env)) continue
    try {
      await processAdjustment(adjustment, { ...dependencies, db, env })
    } catch (error) {
      await (dependencies.logError || logErrorToDatabase)('recovery_billing_adjustment.processing_failed', error, { adjustmentId: adjustment.id })
    }
  }
  return candidates.rowCount + due.rowCount
}
