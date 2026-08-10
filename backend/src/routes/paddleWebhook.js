import crypto from 'crypto'
import express from 'express'
import { Buffer } from 'node:buffer'
import { pool, logErrorToDatabase } from '../db/client.js'
import { recordFailedPaymentAttempt } from '../services/paymentRetry.js'
import { trackEvent } from '../services/analytics.js'
import { triggerWebhook } from '../services/webhookService.js'
import {
  resolvePaddleConfig,
  resolvePaddleEnvironmentForUser,
} from '../config/paddle.js'
import {
  getWebhookEventType,
  getPaddleSubscriptionLifecycleProjection,
  mapToSubscriptionStatus,
  verifyPaddleSignature,
  getEventDeduplicationId,
  getTransactionSubscriptionId,
} from '../utils/paddleWebhook.js'
import {
  getPlanChangeMetadata,
  inferPlanFromPaddlePayload,
  isSubscriptionUpdateTransaction,
  PLAN_CHANGE_RECOVERY_OUTCOME,
  recoverFailedPaddlePlanChange,
} from '../services/paddlePlanChangeRecovery.js'
import {
  isRecoveryBillingAdjustmentEnabled,
  runRecoveryBillingAdjustments,
} from '../services/recoveryBillingAdjustment.js'
import { markCheckoutReservationCompleted } from '../services/paddleCheckoutReservations.js'
import { applyPaddleSubscriptionLifecycle } from '../services/paddleSubscriptionLifecycle.js'
import { isDurableWebhookInboxEnabled } from '../services/paddleBillingReadiness.js'

const router = express.Router()
const WEBHOOK_PROCESSING_LEASE_SECONDS = 120
const WEBHOOK_HEARTBEAT_INTERVAL_MS = 40_000
export const PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS = 6
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]

export function getPaddleWebhookRetryDelayMs(attemptNumber) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Number(attemptNumber || 1) - 1))
  return RETRY_DELAYS_MS[index]
}

export { isDurableWebhookInboxEnabled }

async function paddleApiRequest(path, options = {}, paddle) {
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
    const error = new Error('Paddle plan change recovery request failed')
    error.status = response.status
    error.code = payload?.error?.code || payload?.code || 'PADDLE_RECOVERY_FAILED'
    throw error
  }
  return payload
}

function getPaddleCustomerId(payload) {
  return (
    payload?.data?.customer_id ||
    payload?.data?.customer?.id ||
    payload?.customer_id ||
    payload?.customer?.id ||
    null
  )
}

function getSubscriptionId(payload, eventType = null) {
  const normalizedEvent = String(eventType || '').toLowerCase()
  if (normalizedEvent.startsWith('transaction.')) {
    return getTransactionSubscriptionId(payload)
  }
  return payload?.data?.id || payload?.subscription_id || payload?.subscription?.id || null
}

function getSubscriptionStatus(payload) {
  return payload?.data?.status || payload?.status || null
}

function isFinalCancellationUser(user = {}, now = new Date()) {
  const status = String(user.subscription_status || '').toLowerCase()
  if (!['canceled', 'cancelled'].includes(status)) return false
  if (!user.cancellation_effective_at) return true

  const effectiveAt = new Date(user.cancellation_effective_at)
  return Number.isNaN(effectiveAt.getTime()) || effectiveAt <= now
}

async function resolveUserFromPayload(payload, paddleEnvironment, strictEnvironment = false) {
  const explicitUserId = payload?.data?.custom_data?.userId || payload?.custom_data?.userId || null
  const providerCustomerId = getPaddleCustomerId(payload)
  const providerSubscriptionId = getTransactionSubscriptionId(payload)
    || (String(payload?.data?.id || '').startsWith('sub_') ? payload.data.id : null)

  async function findOwnershipConflict(user) {
    if (!user || (!providerCustomerId && !providerSubscriptionId)) return null

    const conflictResult = await pool.query(
      `SELECT id, 'user' AS source
       FROM users
       WHERE id <> $1
         AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $2
         AND (
           ($3::text IS NOT NULL AND paddle_customer_id = $3)
           OR ($4::text IS NOT NULL AND paddle_subscription_id = $4)
         )
       UNION ALL
       SELECT user_id AS id, 'subscription_projection' AS source
       FROM subscriptions
       WHERE $4::text IS NOT NULL
         AND paddle_subscription_id = $4
         AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $2
         AND user_id IS NOT NULL
         AND user_id <> $1
       LIMIT 1`,
      [user.id, paddleEnvironment, providerCustomerId, providerSubscriptionId],
    )
    const conflict = conflictResult.rows[0]
    if (!conflict || String(conflict.id || '') === String(user.id)) return null

    return {
      existingOwnerId: conflict.id,
      source: conflict.source,
      providerCustomerId,
      providerSubscriptionId,
    }
  }

  if (explicitUserId) {
    const result = await pool.query(
      `SELECT id, paddle_customer_id, paddle_subscription_id, subscription_status, subscription_plan,
              current_period_end, next_billing_date, subscription_renewal_date, cancellation_effective_at,
              paddle_environment, last_paddle_event_at, trial_ends_at, trial_consumed_at,
              subscription_started_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [explicitUserId],
    )

    const user = result.rows[0] || null
    const userEnvironment = user ? resolvePaddleEnvironmentForUser(user) : null

    return {
      user,
      environmentMismatch: Boolean(strictEnvironment && user && userEnvironment !== paddleEnvironment),
      ownershipConflict: await findOwnershipConflict(user),
    }
  }

  const paddleCustomerId = getPaddleCustomerId(payload)

  if (!paddleCustomerId) {
    return { user: null, environmentMismatch: false, ownershipConflict: null }
  }

  const result = await pool.query(
    `SELECT id, paddle_customer_id, paddle_subscription_id, subscription_status, subscription_plan,
            current_period_end, next_billing_date, subscription_renewal_date, cancellation_effective_at,
            paddle_environment, last_paddle_event_at, trial_ends_at, trial_consumed_at,
            subscription_started_at, updated_at
     FROM users
     WHERE paddle_customer_id = $1
       AND ($2::boolean = FALSE OR COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $3)
     LIMIT 1`,
    [paddleCustomerId, strictEnvironment, paddleEnvironment],
  )

  const user = result.rows[0] || null
  return {
    user,
    environmentMismatch: false,
    ownershipConflict: await findOwnershipConflict(user),
  }
}

function shouldApplyFailedPaymentToUser(user, payload, eventType) {
  if (!user?.id) {
    return false
  }

  const failedSubscriptionId = getTransactionSubscriptionId(payload)
  const failedCustomerId = getPaddleCustomerId(payload)

  if (user.subscription_status !== 'active' && user.subscription_status !== 'trialing') {
    return true
  }

  if (failedSubscriptionId && user.paddle_subscription_id && failedSubscriptionId === user.paddle_subscription_id) {
    return true
  }

  console.warn('[Paddle webhook] skipping stale failed-payment status update for active user', {
    eventType,
    transactionId: payload?.data?.id || payload?.transaction_id || payload?.id || null,
    failedSubscriptionId,
    currentSubscriptionId: user.paddle_subscription_id,
    customerId: failedCustomerId,
    userId: user.id,
  })
  return false
}

function shouldPreservePaidPlanDuringUpdate(user, payload, paddle, eventType) {
  if (!user?.id) return false

  const metadata = getPlanChangeMetadata(payload)
  if (eventType === 'transaction.failed' || eventType === 'transaction.payment_failed') {
    if (!isSubscriptionUpdateTransaction(payload)) return false
    return Boolean(metadata || ['active', 'trialing'].includes(String(user.subscription_status || '').toLowerCase()))
  }

  const eventStatus = String(payload?.data?.status || payload?.status || '').toLowerCase()
  const eventPlan = inferPlanFromPaddlePayload(payload, paddle)
  const currentPlan = String(user.subscription_plan || '').toLowerCase()
  const hasPaidEntitlement = ['active', 'trialing'].includes(String(user.subscription_status || '').toLowerCase())

  return Boolean(
    hasPaidEntitlement
      && eventPlan
      && currentPlan
      && eventPlan !== currentPlan
      && ['active', 'past_due'].includes(eventStatus),
  )
}

function getProviderEventTimestamp(payload) {
  const value = payload?.occurred_at || payload?.notification?.occurred_at || null
  if (!value) return null
  const parsed = new Date(value)
  // SQL ordering permits an undated event only while no authoritative provider
  // timestamp has been stored, preserving compatibility for pre-migration rows.
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function restorePlanChangeEntitlement(user, metadata, db = pool) {
  if (!user?.id || !metadata?.fromPlan) return

  const priorStatus = ['active', 'trialing'].includes(metadata.priorStatus)
    ? metadata.priorStatus
    : ['active', 'trialing'].includes(String(user.subscription_status || '').toLowerCase())
      ? String(user.subscription_status).toLowerCase()
      : 'active'

  await db.query(
    `UPDATE users
     SET subscription_plan = $2,
         subscription_status = $3,
         current_period_end = COALESCE($4, current_period_end),
         next_billing_date = COALESCE($5, next_billing_date),
         subscription_renewal_date = COALESCE($6, subscription_renewal_date),
         updated_at = NOW()
     WHERE id = $1`,
    [
      user.id,
      metadata.fromPlan,
      priorStatus,
      metadata.priorCurrentPeriodEnd,
      metadata.priorNextBillingDate || metadata.priorCurrentPeriodEnd,
      metadata.priorRenewalDate || metadata.priorCurrentPeriodEnd,
    ],
  )
}

async function recoverFailedPlanChangeFromWebhook(user, payload, paddle) {
  const metadata = getPlanChangeMetadata(payload)
  if (!metadata) return { outcome: PLAN_CHANGE_RECOVERY_OUTCOME.NOT_APPLICABLE }

  const result = await recoverFailedPaddlePlanChange({
    request: (path, options = {}) => paddleApiRequest(path, options, paddle),
    subscriptionId: getTransactionSubscriptionId(payload) || getSubscriptionId(payload),
    transactionId: isSubscriptionUpdateTransaction(payload) ? (payload?.data?.id || payload?.id || null) : null,
    metadata,
    existingCustomData: payload?.data?.custom_data || payload?.custom_data || {},
  })

  return { ...result, metadata }
}

function getSafeErrorContext(error) {
  return {
    code: error?.code || error?.name || 'UNKNOWN_ERROR',
    message: error?.message || String(error),
  }
}

function planFromPriceId(priceId, paddleConfig) {
  if (!priceId) return null
  if (priceId === paddleConfig.priceIdsByPlan.monthly) return 'monthly'
  if (priceId === paddleConfig.priceIdsByPlan.annual) return 'annual'
  if (priceId === paddleConfig.noTrialPriceIdsByPlan?.monthly) return 'monthly'
  if (priceId === paddleConfig.noTrialPriceIdsByPlan?.annual) return 'annual'
  if (priceId === paddleConfig.testUpgrade?.annualPriceId) return 'annual'
  if (priceId === paddleConfig.testUpgrade?.monthlyPriceId) return 'monthly'
  if (paddleConfig.legacyPriceIdsByPlan?.monthly?.includes(priceId)) return 'monthly'
  if (paddleConfig.legacyPriceIdsByPlan?.annual?.includes(priceId)) return 'annual'
  return null
}

function getItemPriceId(item = {}) {
  return item?.price?.id || item?.price_id || item?.priceId || null
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getItemTotal(item = {}) {
  return numericOrNull(
    item?.totals?.total ??
    item?.details?.totals?.total ??
    item?.amount ??
    item?.unit_totals?.total ??
    item?.price?.unit_price?.amount,
  )
}

function isCreditOrRemovalItem(item = {}) {
  const quantity = numericOrNull(item?.quantity)
  const total = getItemTotal(item)
  const text = [item?.type, item?.status, item?.description, item?.name, item?.price?.description, item?.price?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    (quantity !== null && quantity < 0) ||
    (total !== null && total < 0) ||
    text.includes('credit') ||
    text.includes('refund') ||
    text.includes('reversal') ||
    text.includes('removed') ||
    text.includes('removal')
  )
}

function getStoredSubscriptionPlan(payload, paddleConfig) {
  const items = payload?.data?.items || payload?.items || []
  const activePlanFromItems = items
    .filter((item) => !isCreditOrRemovalItem(item))
    .map((item) => planFromPriceId(getItemPriceId(item), paddleConfig))
    .find(Boolean)

  if (activePlanFromItems) {
    return activePlanFromItems
  }

  if (items.length > 0) {
    return null
  }

  const plan = payload?.data?.custom_data?.plan || payload?.custom_data?.plan || null

  if (plan === 'test-monthly') {
    return 'monthly'
  }

  return plan === 'monthly' || plan === 'annual' ? plan : null
}

function getPaymentAmount(payload) {
  const cents = payload?.data?.details?.totals?.total || payload?.data?.totals?.total || payload?.amount || null

  if (typeof cents === 'number') {
    return Number((cents / 100).toFixed(2))
  }

  const numeric = Number(cents)
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    return Number((numeric / 100).toFixed(2))
  }

  return 0
}

async function markPaymentAttemptSucceeded(payload, db = pool) {
  const transactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null

  if (!transactionId) {
    return
  }

  await db.query(
    `UPDATE payment_attempts
     SET status = 'succeeded',
         next_retry_at = NULL,
         updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE transaction_id = $1`,
    [transactionId, JSON.stringify({ resolved_by: 'webhook', event: 'transaction.completed' })],
  )
}

function normalizeInboxStatus(status) {
  const normalized = String(status || '').toLowerCase()
  return normalized || 'completed'
}

async function getWebhookInboxEvent(eventId) {
  const result = await pool.query(
    `SELECT event_id, payload_hash, paddle_environment, status, attempt_count, last_attempt_at
     FROM paddle_webhook_events
     WHERE event_id = $1
     LIMIT 1`,
    [eventId],
  )
  return result.rows[0] || null
}

export async function persistVerifiedWebhookInboxEvent({ eventId, eventType, payloadHash, payload, environment }) {
  const existingBeforeInsert = await getWebhookInboxEvent(eventId)
  if (existingBeforeInsert) {
    if (
      (existingBeforeInsert.payload_hash && existingBeforeInsert.payload_hash !== payloadHash)
      || (existingBeforeInsert.paddle_environment && existingBeforeInsert.paddle_environment !== environment)
    ) {
      return { persisted: false, conflict: true }
    }
    return {
      persisted: true,
      duplicate: true,
      status: normalizeInboxStatus(existingBeforeInsert.status),
    }
  }

  const insertResult = await pool.query(
    `WITH inserted_event AS (
       INSERT INTO paddle_webhook_events (
         event_id,
         event_type,
         payload_hash,
         payload,
         paddle_environment,
         status,
         attempt_count,
         first_received_at,
         last_attempt_at,
         processed_at,
         processing_token,
         verified_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, 'processing', 0, NOW(), NULL, NULL, NULL, NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id
     ), audit_entry AS (
       INSERT INTO paddle_webhook_audit (event_type, payload, signature_valid, error_message)
       SELECT $2, $4::jsonb, TRUE, NULL
       FROM inserted_event
     )
     SELECT * FROM inserted_event`,
    [eventId, eventType || 'unknown', payloadHash, JSON.stringify(payload), environment],
  )

  if (insertResult.rowCount > 0) {
    return { persisted: true, duplicate: false }
  }

  const existing = await getWebhookInboxEvent(eventId)
  if (!existing) {
    const error = new Error('Paddle webhook inbox insert did not persist an event')
    error.code = 'PADDLE_WEBHOOK_PERSISTENCE_FAILED'
    throw error
  }

  if (
    (existing.payload_hash && existing.payload_hash !== payloadHash)
    || (existing.paddle_environment && existing.paddle_environment !== environment)
  ) {
    return { persisted: false, conflict: true }
  }

  return { persisted: true, duplicate: true, status: normalizeInboxStatus(existing.status) }
}

export async function reclaimWebhookInboxEvent({ eventId, payloadHash, payload, environment, processingToken, source = 'live' }) {
  const retryResult = await pool.query(
    `UPDATE paddle_webhook_events
     SET status = 'processing',
         attempt_count = GREATEST(COALESCE(attempt_count, 0), 0) + 1,
         last_attempt_at = NOW(),
         failed_at = NULL,
         next_retry_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         payload = COALESCE(payload, $3::jsonb),
         paddle_environment = COALESCE(paddle_environment, $4),
         processing_token = $5,
         verified_at = CASE WHEN $7 = 'live' THEN COALESCE(verified_at, NOW()) ELSE verified_at END,
         scheduler_attempt_count = COALESCE(scheduler_attempt_count, 0) + CASE WHEN $7 = 'scheduled' THEN 1 ELSE 0 END
     WHERE event_id = $1
       AND payload_hash = $2
       AND COALESCE(paddle_environment, $4) = $4
       AND (
         (
           status = 'retryable_failed'
           AND ($7 <> 'scheduled' OR next_retry_at IS NULL OR next_retry_at <= NOW())
           AND ($7 <> 'scheduled' OR COALESCE(scheduler_attempt_count, 0) < $8)
         )
         OR (
           status = 'processing'
           AND ($7 <> 'scheduled' OR COALESCE(scheduler_attempt_count, 0) < $8)
           AND (
             last_attempt_at IS NULL
             OR last_attempt_at <= NOW() - ($6::integer * INTERVAL '1 second')
           )
         )
       )
     RETURNING event_id, attempt_count, scheduler_attempt_count`,
    [eventId, payloadHash, JSON.stringify(payload), environment, processingToken, WEBHOOK_PROCESSING_LEASE_SECONDS, source, PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS],
  )

  if (retryResult.rowCount === 0) return null
  return retryResult.rows[0] || null
}

async function claimWebhookInboxEvent({
  eventId,
  eventType,
  payloadHash,
  payload,
  environment,
  source = 'live',
}) {
  const processingToken = crypto.randomUUID()
  const existing = await getWebhookInboxEvent(eventId)

  if (existing) {
    if (existing.payload_hash && existing.payload_hash !== payloadHash) {
      return { claimed: false, conflict: true }
    }

    if (normalizeInboxStatus(existing.status) === 'completed') {
      return { claimed: false, duplicate: true, status: 'completed' }
    }

    if (normalizeInboxStatus(existing.status) === 'terminal_failed'
      && (!existing.paddle_environment || existing.paddle_environment === environment)) {
      return { claimed: false, duplicate: true, status: 'terminal_failed' }
    }

    const attempt = await reclaimWebhookInboxEvent({
      eventId, payloadHash, payload, environment, processingToken, source,
    })

    if (!attempt) {
      return { claimed: false, duplicate: true, status: 'processing' }
    }

    return {
      claimed: true,
      retry: true,
      attemptCount: attempt.attempt_count,
      schedulerAttemptCount: attempt.scheduler_attempt_count,
      processingToken,
    }
  }

  const insertResult = await pool.query(
    `INSERT INTO paddle_webhook_events (
       event_id,
       event_type,
       payload_hash,
       payload,
       paddle_environment,
       status,
       attempt_count,
       first_received_at,
       last_attempt_at,
       processed_at,
       processing_token,
       verified_at
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, 'processing', 1, NOW(), NOW(), NULL, $6, NOW())
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, eventType || 'unknown', payloadHash, JSON.stringify(payload), environment, processingToken],
  )

  if (insertResult.rowCount > 0) {
    return { claimed: true, retry: false, attemptCount: 1, schedulerAttemptCount: 0, processingToken }
  }

  const racedEvent = await getWebhookInboxEvent(eventId)
  if (racedEvent?.payload_hash && racedEvent.payload_hash !== payloadHash) {
    return { claimed: false, conflict: true }
  }

  if (normalizeInboxStatus(racedEvent?.status) === 'completed') {
    return { claimed: false, duplicate: true, status: 'completed' }
  }

  if (normalizeInboxStatus(racedEvent?.status) === 'terminal_failed'
    && (!racedEvent?.paddle_environment || racedEvent.paddle_environment === environment)) {
    return { claimed: false, duplicate: true, status: 'terminal_failed' }
  }

  const attempt = await reclaimWebhookInboxEvent({
    eventId, payloadHash, payload, environment, processingToken, source,
  })
  return attempt
    ? { claimed: true, retry: true, attemptCount: attempt.attempt_count, schedulerAttemptCount: attempt.scheduler_attempt_count, processingToken }
    : { claimed: false, duplicate: true, status: 'processing' }
}

async function claimLegacyCompatibleWebhookEvent({
  eventId,
  payloadHash,
}) {
  const existing = await getWebhookInboxEvent(eventId)

  if (!existing) {
    // Compatibility instances stay passive until durable mode is enabled.
    // This closes the no-row race with a durable-enabled instance without
    // exposing non-terminal rows to pre-inbox releases during phase 1.
    return { claimed: false, retryable: true, status: 'rollout_paused' }
  }

  if (existing.payload_hash && existing.payload_hash !== payloadHash) {
    return { claimed: false, conflict: true }
  }

  if (normalizeInboxStatus(existing.status) === 'completed') {
    return { claimed: false, duplicate: true, status: 'completed' }
  }

  // A passive instance must not reclaim or process durable work. It asks
  // Paddle to retry so a durable-enabled instance can acquire the fenced claim.
  return { claimed: false, retryable: true, status: 'processing' }
}

async function completeWebhookInboxEvent(eventId, payloadHash, environment, attemptCount, processingToken) {
  const result = await pool.query(
    `UPDATE paddle_webhook_events
     SET status = 'completed',
         processed_at = NOW(),
         completed_at = NOW(),
         failed_at = NULL,
         next_retry_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
     WHERE event_id = $1
       AND payload_hash = $2
       AND COALESCE(paddle_environment, $3) = $3
       AND status = 'processing'
       AND attempt_count = $4
       AND processing_token = $5`,
    [eventId, payloadHash, environment, attemptCount, processingToken],
  )

  if (result.rowCount === 0) {
    throw new Error('Paddle webhook inbox claim was lost before completion')
  }
}

async function failWebhookInboxEvent(eventId, payloadHash, environment, attemptCount, processingToken, error, schedulerAttemptCount = 0) {
  const safeError = getSafeErrorContext(error)
  const terminal = Boolean(error?.permanent) || schedulerAttemptCount >= PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS
  const retryDelayMs = getPaddleWebhookRetryDelayMs(Math.max(1, schedulerAttemptCount))
  await pool.query(
    `UPDATE paddle_webhook_events
     SET status = 'retryable_failed',
         failed_at = NOW(),
         next_retry_at = NOW() + ($8::integer * INTERVAL '1 millisecond'),
         last_error_code = LEFT($6, 120),
         last_error_message = LEFT($7, 500)
     WHERE event_id = $1
       AND payload_hash = $2
       AND COALESCE(paddle_environment, $3) = $3
       AND status = 'processing'
       AND attempt_count = $4
       AND processing_token = $5`,
    [eventId, payloadHash, environment, attemptCount, processingToken, safeError.code, safeError.message, retryDelayMs],
  )
  if (terminal) {
    await pool.query(
      `UPDATE paddle_webhook_events
       SET status = 'terminal_failed', next_retry_at = NULL
       WHERE event_id = $1 AND payload_hash = $2
         AND COALESCE(paddle_environment, $3) = $3
         AND status = 'retryable_failed' AND attempt_count = $4 AND processing_token = $5`,
      [eventId, payloadHash, environment, attemptCount, processingToken],
    )
  }
  return terminal ? 'terminal_failed' : 'retryable_failed'
}

export function createWebhookInboxLease({
  eventId,
  payloadHash,
  environment,
  attemptCount,
  processingToken,
  heartbeatIntervalMs = WEBHOOK_HEARTBEAT_INTERVAL_MS,
}) {
  let timer = null
  let renewal = null
  let ownershipLost = false
  let closed = false

  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const renew = async () => {
    try {
      const result = await pool.query(
        `UPDATE paddle_webhook_events
         SET last_attempt_at = NOW()
         WHERE event_id = $1
           AND payload_hash = $2
           AND COALESCE(paddle_environment, $3) = $3
           AND status = 'processing'
           AND attempt_count = $4
           AND processing_token = $5`,
        [eventId, payloadHash, environment, attemptCount, processingToken],
      )
      if (result.rowCount === 0) ownershipLost = true
    } catch (error) {
      ownershipLost = true
      console.error('[Paddle webhook] inbox lease renewal failed', getSafeErrorContext(error))
    } finally {
      renewal = null
      if (ownershipLost) stopTimer()
    }
  }

  const tick = () => {
    if (closed || ownershipLost || renewal) return
    renewal = renew()
  }

  timer = setInterval(tick, heartbeatIntervalMs)
  timer.unref?.()

  const assertOwned = async () => {
    if (renewal) await renewal
    if (ownershipLost) throw new Error('Paddle webhook inbox claim was lost during processing')
  }

  return {
    assertOwned,
    async finish(task) {
      closed = true
      stopTimer()
      await assertOwned()
      return task()
    },
    async stop() {
      closed = true
      stopTimer()
      if (renewal) await renewal
    },
  }
}

async function upsertSubscriptionProjection({ subscriptionId, userId, status, eventType, payload, environment }, db = pool) {
  if (!subscriptionId || !status) return

  await db.query(
    `INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload, paddle_environment)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (paddle_environment, paddle_subscription_id)
     DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
       status = EXCLUDED.status,
       latest_event_type = EXCLUDED.latest_event_type,
       latest_event_payload = EXCLUDED.latest_event_payload,
       updated_at = NOW(),
       paddle_environment = EXCLUDED.paddle_environment
     WHERE (subscriptions.user_id IS NULL OR EXCLUDED.user_id IS NULL OR subscriptions.user_id = EXCLUDED.user_id)
       AND COALESCE(NULLIF(LOWER(subscriptions.paddle_environment), ''), 'production')
           = COALESCE(NULLIF(LOWER(EXCLUDED.paddle_environment), ''), 'production')
       AND (
         (
           COALESCE(EXCLUDED.latest_event_payload #>> '{data,current_billing_period,ends_at}', EXCLUDED.latest_event_payload #>> '{data,billing_period,ends_at}') IS NOT NULL
           AND (
             COALESCE(subscriptions.latest_event_payload #>> '{data,current_billing_period,ends_at}', subscriptions.latest_event_payload #>> '{data,billing_period,ends_at}') IS NULL
             OR COALESCE(EXCLUDED.latest_event_payload #>> '{data,current_billing_period,ends_at}', EXCLUDED.latest_event_payload #>> '{data,billing_period,ends_at}')::timestamptz
                >= COALESCE(subscriptions.latest_event_payload #>> '{data,current_billing_period,ends_at}', subscriptions.latest_event_payload #>> '{data,billing_period,ends_at}')::timestamptz
             OR (
               COALESCE(EXCLUDED.latest_event_payload #>> '{occurred_at}', EXCLUDED.latest_event_payload #>> '{notification,occurred_at}') IS NOT NULL
               AND COALESCE(
                 subscriptions.latest_event_payload #>> '{occurred_at}',
                 subscriptions.latest_event_payload #>> '{notification,occurred_at}',
                 subscriptions.latest_event_payload #>> '{provider_observed_at}'
               ) IS NOT NULL
               AND COALESCE(EXCLUDED.latest_event_payload #>> '{occurred_at}', EXCLUDED.latest_event_payload #>> '{notification,occurred_at}')::timestamptz
                  > COALESCE(
                    subscriptions.latest_event_payload #>> '{occurred_at}',
                    subscriptions.latest_event_payload #>> '{notification,occurred_at}',
                    subscriptions.latest_event_payload #>> '{provider_observed_at}'
                  )::timestamptz
             )
           )
         ) OR (
           COALESCE(EXCLUDED.latest_event_payload #>> '{data,current_billing_period,ends_at}', EXCLUDED.latest_event_payload #>> '{data,billing_period,ends_at}') IS NULL
           AND COALESCE(subscriptions.latest_event_payload #>> '{data,current_billing_period,ends_at}', subscriptions.latest_event_payload #>> '{data,billing_period,ends_at}') IS NULL
         )
       )
     RETURNING user_id, paddle_environment`,
    [subscriptionId, userId || null, status, eventType, JSON.stringify(payload), environment],
  ).then(async (result) => {
    if (result.rowCount > 0) return

    const existing = await db.query(
      `SELECT user_id, paddle_environment
       FROM subscriptions
       WHERE paddle_subscription_id = $1
         AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $2`,
      [subscriptionId, environment],
    )
    const row = existing.rows[0]
    const existingEnvironment = resolvePaddleEnvironmentForUser({ paddle_environment: row?.paddle_environment })
    if (
      row?.user_id != null
      && userId != null
      && (String(row.user_id) !== String(userId) || existingEnvironment !== environment)
    ) {
      const error = new Error('Paddle subscription projection is already owned by another HireFlow account')
      error.code = 'PADDLE_OWNERSHIP_CONFLICT'
      throw error
    }
  })
}

async function withWebhookTransaction(task) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await task(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function recoveredSubscriptionProjection(currentProjection, recovery) {
  if (!currentProjection || recovery?.outcome !== PLAN_CHANGE_RECOVERY_OUTCOME.RECOVERED) {
    return currentProjection
  }

  const authoritativePayload = recovery.finalPayload || recovery.restoredPayload || currentProjection.payload
  const authoritativeStatus = getSubscriptionStatus(authoritativePayload)
    || (['active', 'trialing'].includes(recovery.metadata?.priorStatus) ? recovery.metadata.priorStatus : 'active')

  return {
    ...currentProjection,
    status: authoritativeStatus,
    payload: authoritativePayload,
  }
}

async function handlePaddleWebhook(req, res, paddle, strictEnvironment, storedEvent = null) {
  const rawBody = storedEvent ? JSON.stringify(storedEvent.payload) : (req.body instanceof Buffer ? req.body.toString('utf8') : '')
  const secret = paddle.webhookSecret || ''
  const incomingSignature = storedEvent ? null : req.headers['paddle-signature']
  const signatureHeader = storedEvent ? null : (typeof incomingSignature === 'string' ? incomingSignature : req.get('Paddle-Signature'))
  const signatureCheck = storedEvent ? { isValid: true, reason: 'previously_verified' } : verifyPaddleSignature(rawBody, signatureHeader, secret)

  if (!signatureCheck.isValid) {
    console.warn('[Paddle webhook] rejected event with invalid signature', {
      hasSignatureHeader: Boolean(signatureHeader),
      reason: signatureCheck.reason,
    })

    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  let payload = storedEvent?.payload

  if (!storedEvent) {
    try {
      payload = JSON.parse(rawBody || '{}')
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' })
    }
  }

  const eventType = getWebhookEventType(payload)
  console.info('[Paddle webhook] received event', {
    environment: paddle.environment,
    eventType,
    hasWebhookSecret: Boolean(secret),
  })

  const dedupeEventId = storedEvent?.eventId || getEventDeduplicationId(payload, rawBody)
  const payloadHash = storedEvent?.payloadHash || crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex')
  const durableInboxEnabled = isDurableWebhookInboxEnabled()

  if (!storedEvent) {
    if (!eventType) {
      return res.status(400).json({ error: 'Webhook event type is required' })
    }

    const payloadEnvironment = payload?.data?.custom_data?.paddleEnvironment
      || payload?.custom_data?.paddleEnvironment
      || null
    if (payloadEnvironment && payloadEnvironment !== paddle.environment) {
      return res.status(400).json({ error: 'Webhook environment mismatch' })
    }

    if (!durableInboxEnabled) {
      res.set('Retry-After', String(WEBHOOK_PROCESSING_LEASE_SECONDS))
      return res.status(503).json({
        error: 'Durable webhook processing is unavailable',
        retryable: true,
      })
    }

    try {
      const persisted = await persistVerifiedWebhookInboxEvent({
        eventId: dedupeEventId,
        eventType,
        payloadHash,
        payload,
        environment: paddle.environment,
      })

      if (persisted.conflict) {
        console.error('[Paddle webhook] rejected reused event id with different payload', {
          environment: paddle.environment,
          eventType,
          eventId: dedupeEventId,
        })
        return res.status(409).json({ error: 'Webhook event payload conflict' })
      }

      return res.status(200).json({
        received: true,
        ...(persisted.duplicate ? { duplicate: true } : {}),
      })
    } catch (error) {
      console.error('[Paddle webhook] failed to durably persist verified event', getSafeErrorContext(error))
      return res.status(500).json({ error: 'Webhook persistence failed' })
    }
  }

  let inboxClaimed = false
  let inboxAttemptCount = null
  let inboxProcessingToken = null
  let inboxSchedulerAttemptCount = 0
  let inboxLease = null
  const completionTasks = []
  const postProcessingTasks = []

  try {
    const claimInput = {
      eventId: dedupeEventId,
      eventType,
      payloadHash,
      payload,
      environment: paddle.environment,
      source: 'scheduled',
    }
    const inboxClaim = durableInboxEnabled
      ? await claimWebhookInboxEvent(claimInput)
      : await claimLegacyCompatibleWebhookEvent(claimInput)

    if (inboxClaim.conflict) {
      console.error('[Paddle webhook] rejected reused event id with different payload', {
        environment: paddle.environment,
        eventType,
        eventId: dedupeEventId,
      })
      return res.status(409).json({ error: 'Webhook event payload conflict' })
    }

    if (!inboxClaim.claimed) {
      if (inboxClaim.status === 'terminal_failed') {
        console.warn('[Paddle webhook] acknowledged terminal event redelivery', {
          environment: paddle.environment,
          eventType,
          eventId: dedupeEventId,
        })
        return res.status(200).json({
          received: true,
          duplicate: true,
        })
      }
      if (inboxClaim.retryable || inboxClaim.status !== 'completed') {
        res.set('Retry-After', String(WEBHOOK_PROCESSING_LEASE_SECONDS))
        return res.status(503).json({
          error: inboxClaim.status === 'rollout_paused'
            ? 'Webhook processing is temporarily paused during rollout'
            : 'Webhook event is already processing',
          retryable: true,
        })
      }
      return res.status(200).json({
        received: true,
        duplicate: true,
      })
    }
    if (!inboxClaim.legacy) {
      inboxClaimed = true
      inboxAttemptCount = inboxClaim.attemptCount
      inboxProcessingToken = inboxClaim.processingToken
      inboxSchedulerAttemptCount = inboxClaim.schedulerAttemptCount || 0
      inboxLease = createWebhookInboxLease({
        eventId: dedupeEventId,
        payloadHash,
        environment: paddle.environment,
        attemptCount: inboxAttemptCount,
        processingToken: inboxProcessingToken,
      })
      if (storedEvent) {
        console.info('[Paddle webhook retry] event claimed', {
          eventId: dedupeEventId,
          eventType,
          environment: paddle.environment,
          attemptNumber: inboxAttemptCount,
          schedulerAttemptNumber: inboxSchedulerAttemptCount,
        })
      }
    }

    if (storedEvent && (!payload || typeof payload !== 'object' || Array.isArray(payload) || !eventType)) {
      const error = new Error('Stored webhook payload is incomplete or unsupported')
      error.code = 'INVALID_STORED_PAYLOAD'
      error.permanent = true
      throw error
    }

    const lifecycleProjection = getPaddleSubscriptionLifecycleProjection(eventType, payload)
    const nextStatus = lifecycleProjection?.status ?? mapToSubscriptionStatus(eventType, payload)
    const providerEventAt = getProviderEventTimestamp(payload)
    const subscriptionId = getSubscriptionId(payload, eventType)
    const payloadEnvironment = payload?.data?.custom_data?.paddleEnvironment || payload?.custom_data?.paddleEnvironment || null
    const userResolution = await resolveUserFromPayload(payload, paddle.environment, strictEnvironment)
    const user = userResolution.user

    if (userResolution.ownershipConflict) {
      console.error('[Paddle webhook] provider ownership conflict rejected', {
        eventType,
        environment: paddle.environment,
        intendedUserId: user?.id || null,
        existingOwnerId: userResolution.ownershipConflict.existingOwnerId,
        ownershipSource: userResolution.ownershipConflict.source,
        customerId: userResolution.ownershipConflict.providerCustomerId,
        subscriptionId: userResolution.ownershipConflict.providerSubscriptionId,
      })
      const ownershipError = new Error('Paddle provider identity is already owned by another HireFlow account')
      ownershipError.code = 'PADDLE_OWNERSHIP_CONFLICT'
      throw ownershipError
    }

    const hasEnvironmentMismatch = Boolean(
      (payloadEnvironment && payloadEnvironment !== paddle.environment)
      || userResolution.environmentMismatch,
    )

    if (hasEnvironmentMismatch) {
      console.warn('[Paddle webhook] skipping event due to environment mismatch', {
        configuredEnvironment: paddle.environment,
        payloadEnvironment,
        userEnvironment: user?.paddle_environment || null,
        eventType,
      })
    }

    let subscriptionProjection = !lifecycleProjection && !hasEnvironmentMismatch && nextStatus && subscriptionId
      ? {
          subscriptionId,
          userId: user?.id || null,
          status: nextStatus,
          eventType,
          payload,
          environment: paddle.environment,
        }
      : null
    let recoveryAdjustmentCandidate = null
    let planChangeRestoration = null

    if (eventType === 'transaction.completed') {
      const userId = user?.id || null
      const transactionSubscriptionId = getTransactionSubscriptionId(payload)
      const transactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null
      const checkoutReservationId = payload?.data?.custom_data?.checkoutReservationId
        || payload?.custom_data?.checkoutReservationId
        || null
      const completedPlanChange = getPlanChangeMetadata(payload)
      const isRecoveredPlanChange = isSubscriptionUpdateTransaction(payload) && completedPlanChange?.outcome === 'recovered'
      let activationApplied = false

      if (!hasEnvironmentMismatch && !isRecoveredPlanChange) {
        await withWebhookTransaction(async (db) => {
          if (userId && transactionId && checkoutReservationId) {
            await markCheckoutReservationCompleted({
              db,
              reservationToken: checkoutReservationId,
              userId,
              environment: paddle.environment,
              transactionId,
              customerId: getPaddleCustomerId(payload),
            })
          }
          if (userId) {
            const activationResult = await db.query(
            `UPDATE users
             SET subscription_status = 'active',
                 subscription_started_at = COALESCE(subscription_started_at, NOW()),
                 quota_anchor_at = COALESCE(quota_anchor_at, $8),
                 trial_consumed_at = COALESCE(trial_consumed_at, NOW()),
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 paddle_customer_id = COALESCE($3, paddle_customer_id),
                 subscription_plan = COALESCE($4, subscription_plan),
                 current_period_end = COALESCE($5, current_period_end),
                 subscription_renewal_date = COALESCE($5, subscription_renewal_date),
                 next_billing_date = COALESCE($6, next_billing_date),
                 cancellation_effective_at = CASE
                   WHEN $2 IS DISTINCT FROM paddle_subscription_id THEN NULL
                   ELSE cancellation_effective_at
                 END,
                 cancellation_reason = CASE
                   WHEN $2 IS DISTINCT FROM paddle_subscription_id THEN NULL
                   ELSE cancellation_reason
                 END,
                 paddle_environment = $7,
                 last_paddle_event_at = CASE
                   WHEN $9::timestamptz IS NULL THEN last_paddle_event_at
                   ELSE GREATEST(COALESCE(last_paddle_event_at, $9::timestamptz), $9::timestamptz)
                 END,
                 updated_at = NOW()
             WHERE id = $1
               AND ($3 IS NULL OR paddle_customer_id IS NULL OR paddle_customer_id = $3)
               AND COALESCE(NULLIF(LOWER(paddle_environment), ''), $7) = $7
               AND (
                 $2 IS DISTINCT FROM paddle_subscription_id
                 OR last_paddle_event_at IS NULL
                 OR ($9::timestamptz IS NOT NULL AND $9::timestamptz >= last_paddle_event_at)
               )
               AND (
                 (
                   $2 IS NOT NULL
                   AND (paddle_subscription_id IS NULL OR $2 = paddle_subscription_id)
                   AND NOT (
                     LOWER(COALESCE(subscription_status, '')) IN ('canceled', 'cancelled')
                     AND (cancellation_effective_at IS NULL OR cancellation_effective_at <= NOW())
                   )
                   AND ($5::timestamp IS NULL OR current_period_end IS NULL OR $5::timestamp >= current_period_end)
                 )
                 OR (
                   $2 IS NOT NULL
                   AND $4 IS NOT NULL
                   AND $5::timestamp IS NOT NULL
                   AND $2 IS DISTINCT FROM paddle_subscription_id
                   AND LOWER(COALESCE(subscription_status, '')) IN ('canceled', 'cancelled')
                   AND (cancellation_effective_at IS NULL OR cancellation_effective_at <= NOW())
                 )
               )`,
            [
              userId,
              transactionSubscriptionId,
              getPaddleCustomerId(payload),
              getStoredSubscriptionPlan(payload, paddle),
              payload?.data?.billing_period?.ends_at || null,
              payload?.data?.billing_period?.ends_at || null,
              paddle.environment,
              payload?.data?.billing_period?.starts_at || null,
              providerEventAt,
            ],
          )
            activationApplied = activationResult.rowCount > 0

            if (
              activationResult.rowCount === 0
              && isFinalCancellationUser(user)
              && transactionSubscriptionId
              && transactionSubscriptionId !== user.paddle_subscription_id
            ) {
              throw new Error('Completed checkout could not replace the cancelled subscription lifecycle')
            }
          }

          // A completed transaction is authoritative for its own payment attempt even
          // when a newer subscription event has already won the user projection CAS.
          await markPaymentAttemptSucceeded(payload, db)
          if (activationApplied && subscriptionProjection) {
            await upsertSubscriptionProjection(subscriptionProjection, db)
          }
        })

        if (userId && transactionId && isRecoveryBillingAdjustmentEnabled(paddle.environment)) {
          recoveryAdjustmentCandidate = { userId, transactionId }
        }

        subscriptionProjection = null

        postProcessingTasks.push(() => trackEvent({
          userId,
          eventType: 'payment_success',
          metadata: {
            source: 'paddle.webhook',
            transaction_id: payload?.data?.id || null,
            plan: payload?.data?.custom_data?.plan || null,
            amount: getPaymentAmount(payload),
            currency: payload?.data?.currency_code || payload?.data?.currency || null,
          },
        }))

        if (activationApplied) {
          completionTasks.push(() => triggerWebhook('subscription.activated', {
            userId,
            subscriptionId: transactionSubscriptionId,
            transactionId,
            status: 'active',
          }, { requireDurableLog: true }))
        }
      }
    }

    if (eventType === 'transaction.failed' || eventType === 'transaction.payment_failed') {
      let preservePaidPlan = !hasEnvironmentMismatch && shouldPreservePaidPlanDuringUpdate(user, payload, paddle, eventType)

      if (preservePaidPlan) {
        if (!getPlanChangeMetadata(payload)) {
          subscriptionProjection = null
        } else {
          const recovery = await recoverFailedPlanChangeFromWebhook(user, payload, paddle)
          preservePaidPlan = recovery.outcome === PLAN_CHANGE_RECOVERY_OUTCOME.RECOVERED
          subscriptionProjection = recoveredSubscriptionProjection(subscriptionProjection, recovery)
          if (preservePaidPlan) {
            planChangeRestoration = { user, metadata: recovery.metadata }
          }
        }
      }

      let failedStatusApplied = false
      const shouldApplyFailure = !hasEnvironmentMismatch
        && !preservePaidPlan
        && shouldApplyFailedPaymentToUser(user, payload, eventType)
      const failedTransactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null
      if (!failedTransactionId) {
        const error = new Error('Failed Paddle transaction is missing its transaction id')
        error.code = 'PADDLE_TRANSACTION_ID_MISSING'
        error.permanent = true
        throw error
      }
      await withWebhookTransaction(async (db) => {
        if (planChangeRestoration) {
          await restorePlanChangeEntitlement(
            planChangeRestoration.user,
            planChangeRestoration.metadata,
            db,
          )
        }

        if (shouldApplyFailure) {
          const failedUpdateResult = await db.query(
            `UPDATE users
             SET subscription_status = $2,
                 paddle_subscription_id = COALESCE($3::text, paddle_subscription_id),
                 paddle_customer_id = COALESCE($4::text, paddle_customer_id),
                 subscription_plan = COALESCE($5::text, subscription_plan),
                 current_period_end = COALESCE($6::timestamp, current_period_end),
                 next_billing_date = COALESCE($7::timestamp, next_billing_date),
                 paddle_environment = $8,
                 last_paddle_event_at = CASE
                   WHEN $9::timestamptz IS NULL THEN last_paddle_event_at
                   ELSE GREATEST(COALESCE(last_paddle_event_at, $9::timestamptz), $9::timestamptz)
                 END,
                 updated_at = NOW()
             WHERE id = $1
               AND (
                 (paddle_subscription_id IS NULL AND $3::text IS NULL)
                 OR paddle_subscription_id = $3::text
               )
               AND ($4::text IS NULL OR paddle_customer_id IS NULL OR paddle_customer_id = $4::text)
               AND COALESCE(NULLIF(LOWER(paddle_environment), ''), $8) = $8
               AND (
                 last_paddle_event_at IS NULL
                 OR ($9::timestamptz IS NOT NULL AND $9::timestamptz >= last_paddle_event_at)
               )`,
            [
              user.id,
              nextStatus || 'payment_failed',
              getTransactionSubscriptionId(payload),
              getPaddleCustomerId(payload),
              getStoredSubscriptionPlan(payload, paddle),
              payload?.data?.billing_period?.ends_at || payload?.data?.current_billing_period?.ends_at || null,
              payload?.data?.billing_period?.ends_at || payload?.data?.next_billed_at || null,
              paddle.environment,
              providerEventAt,
            ],
          )
          failedStatusApplied = failedUpdateResult.rowCount > 0
          if (!failedStatusApplied) subscriptionProjection = null
        }

        if (failedStatusApplied || !shouldApplyFailure) {
          await recordFailedPaymentAttempt(payload, null, paddle.environment, db)
        }

        if (subscriptionProjection) {
          await upsertSubscriptionProjection(subscriptionProjection, db)
        }
      })
      subscriptionProjection = null

      postProcessingTasks.push(() => trackEvent({
        userId: user?.id || null,
        eventType: 'payment_fail',
        metadata: {
          source: 'paddle.webhook',
          transaction_id: payload?.data?.id || null,
          plan: payload?.data?.custom_data?.plan || null,
          amount: getPaymentAmount(payload),
          currency: payload?.data?.currency_code || payload?.data?.currency || null,
        },
      }))
    }

    if (lifecycleProjection && !hasEnvironmentMismatch) {
      const lifecycleEventType = lifecycleProjection.eventType
      const lifecycleStatus = lifecycleProjection.status
      const subscriptionFromEvent = getSubscriptionId(payload, lifecycleEventType)
      let preservePaidPlan = lifecycleEventType === 'subscription.updated'
        && shouldPreservePaidPlanDuringUpdate(user, payload, paddle, lifecycleEventType)

      if (!lifecycleStatus) {
        console.warn('[Paddle webhook] unsupported subscription lifecycle state ignored', {
          eventType: lifecycleEventType,
          environment: paddle.environment,
          providerStatus: getSubscriptionStatus(payload),
          reason: lifecycleProjection.reason,
          userId: user?.id || null,
          subscriptionId: subscriptionFromEvent,
        })
      } else {
        if (preservePaidPlan && getPlanChangeMetadata(payload) && lifecycleStatus === 'past_due') {
          const recovery = await recoverFailedPlanChangeFromWebhook(user, payload, paddle)
          preservePaidPlan = recovery.outcome === PLAN_CHANGE_RECOVERY_OUTCOME.RECOVERED
          subscriptionProjection = recoveredSubscriptionProjection({
            subscriptionId: subscriptionFromEvent,
            userId: user?.id || null,
            status: lifecycleStatus,
            eventType: lifecycleEventType,
            payload,
            environment: paddle.environment,
          }, recovery)
          if (preservePaidPlan) {
            planChangeRestoration = { user, metadata: recovery.metadata }
          }
        }

        if (!preservePaidPlan && user?.id) {
          const lifecycleResult = await applyPaddleSubscriptionLifecycle({
            user,
            subscriptionId: subscriptionFromEvent,
            customerId: getPaddleCustomerId(payload),
            environment: paddle.environment,
            eventType: lifecycleEventType,
            status: lifecycleStatus,
            plan: getStoredSubscriptionPlan(payload, paddle),
            providerEventAt,
            payload,
          })

          if (
            !lifecycleResult.applied
            && isFinalCancellationUser(user)
            && lifecycleStatus === 'active'
            && subscriptionFromEvent
            && subscriptionFromEvent !== user.paddle_subscription_id
          ) {
            throw new Error('Active subscription could not replace the cancelled subscription lifecycle')
          }

          console.info('[Paddle webhook] subscription lifecycle projection', {
            eventType: lifecycleEventType,
            environment: paddle.environment,
            userId: user.id,
            subscriptionId: subscriptionFromEvent,
            status: lifecycleStatus,
            applied: lifecycleResult.applied,
            reason: lifecycleResult.reason,
          })

          if (lifecycleResult.applied && lifecycleStatus === 'cancelled') {
            postProcessingTasks.push(() => trackEvent({
              userId: user.id,
              eventType: 'cancellation',
              metadata: {
                source: 'paddle.webhook',
                subscription_id: subscriptionFromEvent,
              },
            }))
          }
        }
      }
    }

    if (subscriptionProjection) {
      if (planChangeRestoration) {
        await withWebhookTransaction(async (db) => {
          await restorePlanChangeEntitlement(
            planChangeRestoration.user,
            planChangeRestoration.metadata,
            db,
          )
          await upsertSubscriptionProjection(subscriptionProjection, db)
        })
      } else {
        await upsertSubscriptionProjection(subscriptionProjection)
      }
    }

    // Integration notification selection and delivery logging must finish before
    // the inbox is completed. Otherwise a crash (or selection failure) in this
    // window would make every Paddle redelivery look like a completed duplicate.
    for (const task of completionTasks) {
      await inboxLease?.assertOwned()
      await task()
      await inboxLease?.assertOwned()
    }
    if (!inboxLease) {
      throw new Error('Paddle webhook processing started without a durable inbox lease')
    }
    await inboxLease.finish(() => completeWebhookInboxEvent(
      dedupeEventId,
      payloadHash,
      paddle.environment,
      inboxAttemptCount,
      inboxProcessingToken,
    ))
    if (storedEvent) {
      console.info('[Paddle webhook retry] event completed', {
        eventId: dedupeEventId,
        eventType,
        environment: paddle.environment,
        attemptNumber: inboxAttemptCount,
      })
    }
    for (const task of postProcessingTasks) {
      try {
        await task()
      } catch (error) {
        console.error('[Paddle webhook] post-processing task failed', getSafeErrorContext(error))
        try {
          await logErrorToDatabase('paddle.webhook.post_processing_failed', error, {
            eventType,
            eventId: dedupeEventId,
            environment: paddle.environment,
          })
        } catch (logError) {
          console.error('[Paddle webhook] failed to persist post-processing error', logError)
        }
      }
    }
    if (recoveryAdjustmentCandidate) {
      const { userId, transactionId } = recoveryAdjustmentCandidate
      setImmediate(() => {
        void runRecoveryBillingAdjustments({
          candidateUserId: userId,
          candidateTransactionId: transactionId,
        }).catch((error) => {
          void logErrorToDatabase('recovery_billing_adjustment.immediate_failed', error, {
            userId,
            transactionId,
            environment: paddle.environment,
          }).catch((logError) => {
            console.error('[Paddle webhook] failed to log immediate recovery adjustment error', logError)
          })
        })
      })
    }
  } catch (error) {
    console.error('[Paddle webhook] failed to update subscription state', error)
    if (inboxClaimed) {
      try {
        await inboxLease.finish(() => failWebhookInboxEvent(
          dedupeEventId,
          payloadHash,
          paddle.environment,
          inboxAttemptCount,
          inboxProcessingToken,
          error,
          inboxSchedulerAttemptCount,
        ))
      } catch (inboxError) {
        console.error('[Paddle webhook] failed to persist retryable inbox state', inboxError)
      }
    }
    try {
      await logErrorToDatabase('paddle.webhook.processing_failed', error, {
        eventType,
        eventId: dedupeEventId,
        environment: paddle.environment,
      })
    } catch (logError) {
      console.error('[Paddle webhook] failed to persist processing error', logError)
    }
    return res.status(500).json({ error: 'Webhook processing failed' })
  } finally {
    await inboxLease?.stop()
  }

  return res.status(200).json({ received: true })
}

export function createPaddleWebhookHandler(environmentOverride = null) {
  return (req, res) => handlePaddleWebhook(
    req,
    res,
    resolvePaddleConfig(process.env, environmentOverride || undefined),
    Boolean(environmentOverride),
  )
}

export async function processStoredPaddleWebhookEvent(event) {
  if (!event?.verified_at) {
    return { outcome: 'skipped', reason: 'unverified' }
  }
  const environment = String(event.paddle_environment || '').toLowerCase()
  if (!['production', 'sandbox'].includes(environment)) {
    return { outcome: 'skipped', reason: 'invalid_environment' }
  }

  let statusCode = 200
  let body = null
  const response = {
    set() {},
    status(code) { statusCode = code; return this },
    json(value) { body = value; return value },
  }
  await handlePaddleWebhook(null, response, resolvePaddleConfig(process.env, environment), true, {
    eventId: event.event_id,
    payloadHash: event.payload_hash,
    payload: event.payload,
  })

  if (statusCode === 200 && !body?.duplicate) return { outcome: 'completed' }
  if (statusCode === 409) return { outcome: 'skipped', reason: 'payload_conflict' }
  if (statusCode === 503) return { outcome: 'ownership_lost' }
  return { outcome: 'failed' }
}

const rawJsonBody = express.raw({ type: 'application/json' })

// Keep the legacy endpoint bound to PADDLE_ENVIRONMENT for existing live
// notification destinations. Explicit endpoints allow live and sandbox events
// to coexist safely in the same production deployment.
router.post('/', rawJsonBody, createPaddleWebhookHandler())
router.post('/production', rawJsonBody, createPaddleWebhookHandler('production'))
router.post('/sandbox', rawJsonBody, createPaddleWebhookHandler('sandbox'))

export default router
