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

const router = express.Router()

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

function getScheduledCancellationEffectiveAt(payload) {
  const scheduledChange = payload?.data?.scheduled_change || payload?.data?.scheduledChange || payload?.scheduled_change || payload?.scheduledChange || null
  const scheduledAction = String(scheduledChange?.action || scheduledChange?.type || '').toLowerCase()
  if (!scheduledAction.includes('cancel')) return null
  return scheduledChange?.effective_at || scheduledChange?.effectiveAt || null
}

async function resolveUserFromPayload(payload, paddleEnvironment, strictEnvironment = false) {
  const explicitUserId = payload?.data?.custom_data?.userId || payload?.custom_data?.userId || null

  if (explicitUserId) {
    const result = await pool.query(
      `SELECT id, paddle_customer_id, paddle_subscription_id, subscription_status, subscription_plan,
              current_period_end, next_billing_date, subscription_renewal_date, paddle_environment, updated_at
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
    }
  }

  const paddleCustomerId = getPaddleCustomerId(payload)

  if (!paddleCustomerId) {
    return { user: null, environmentMismatch: false }
  }

  const result = await pool.query(
    `SELECT id, paddle_customer_id, paddle_subscription_id, subscription_status, subscription_plan,
            current_period_end, next_billing_date, subscription_renewal_date, paddle_environment, updated_at
     FROM users
     WHERE paddle_customer_id = $1
       AND ($2::boolean = FALSE OR COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $3)
     LIMIT 1`,
    [paddleCustomerId, strictEnvironment, paddleEnvironment],
  )

  return { user: result.rows[0] || null, environmentMismatch: false }
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

async function restorePlanChangeEntitlement(user, metadata) {
  if (!user?.id || !metadata?.fromPlan) return

  const priorStatus = ['active', 'trialing'].includes(metadata.priorStatus)
    ? metadata.priorStatus
    : ['active', 'trialing'].includes(String(user.subscription_status || '').toLowerCase())
      ? String(user.subscription_status).toLowerCase()
      : 'active'

  await pool.query(
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

  if (result.outcome === PLAN_CHANGE_RECOVERY_OUTCOME.RECOVERED) {
    await restorePlanChangeEntitlement(user, metadata)
  }

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

async function markPaymentAttemptSucceeded(payload) {
  const transactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null

  if (!transactionId) {
    return
  }

  await pool.query(
    `UPDATE payment_attempts
     SET status = 'succeeded',
         next_retry_at = NULL,
         updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE transaction_id = $1`,
    [transactionId, JSON.stringify({ resolved_by: 'webhook', event: 'transaction.completed' })],
  )
}

async function logWebhookAudit(eventType, payload, isValidSignature, errorMessage = null) {
  await pool.query(
    `INSERT INTO paddle_webhook_audit (event_type, payload, signature_valid, error_message)
     VALUES ($1, $2::jsonb, $3, $4)`,
    [eventType || 'unknown', JSON.stringify(payload), isValidSignature, errorMessage],
  )
}

async function ensureWebhookEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS paddle_webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT,
      payload_hash TEXT NOT NULL,
      processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_paddle_webhook_events_created_at
      ON paddle_webhook_events (created_at DESC);
  `)
}

async function upsertSubscriptionProjection({ subscriptionId, userId, status, eventType, payload, environment }) {
  if (!subscriptionId || !status) return

  await pool.query(
    `INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload, paddle_environment)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (paddle_subscription_id)
     DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
       status = EXCLUDED.status,
       latest_event_type = EXCLUDED.latest_event_type,
       latest_event_payload = EXCLUDED.latest_event_payload,
       updated_at = NOW(),
       paddle_environment = EXCLUDED.paddle_environment`,
    [subscriptionId, userId || null, status, eventType, JSON.stringify(payload), environment],
  )
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

async function handlePaddleWebhook(req, res, paddle, strictEnvironment) {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : ''
  const secret = paddle.webhookSecret || ''
  const incomingSignature = req.headers['paddle-signature']
  const signatureHeader = typeof incomingSignature === 'string' ? incomingSignature : req.get('Paddle-Signature')
  const signatureCheck = verifyPaddleSignature(rawBody, signatureHeader, secret)

  if (!signatureCheck.isValid) {
    console.warn('[Paddle webhook] rejected event with invalid signature', {
      hasSignatureHeader: Boolean(signatureHeader),
      reason: signatureCheck.reason,
    })

    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  let payload

  try {
    payload = JSON.parse(rawBody || '{}')
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' })
  }

  const eventType = getWebhookEventType(payload)
  console.info('[Paddle webhook] received event', {
    environment: paddle.environment,
    eventType,
    hasWebhookSecret: Boolean(secret),
  })

  try {
    await logWebhookAudit(eventType, payload, signatureCheck.isValid, signatureCheck.reason)
  } catch (error) {
    console.error('[Paddle webhook] failed to write audit log', error)
  }

  try {
    await ensureWebhookEventsTable()

    const dedupeEventId = getEventDeduplicationId(payload, rawBody)
    const payloadHash = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex')

    const existingEventResult = await pool.query(
      `SELECT event_id
       FROM paddle_webhook_events
       WHERE event_id = $1
       LIMIT 1`,
      [dedupeEventId],
    )

    if (existingEventResult.rowCount > 0) {
      return res.status(200).json({ received: true, duplicate: true })
    }

    const nextStatus = mapToSubscriptionStatus(eventType, payload)
    const subscriptionId = getSubscriptionId(payload, eventType)
    const payloadEnvironment = payload?.data?.custom_data?.paddleEnvironment || payload?.custom_data?.paddleEnvironment || null
    const userResolution = await resolveUserFromPayload(payload, paddle.environment, strictEnvironment)
    const user = userResolution.user
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

    let subscriptionProjection = !hasEnvironmentMismatch && nextStatus && subscriptionId
      ? {
          subscriptionId,
          userId: user?.id || null,
          status: nextStatus,
          eventType,
          payload,
          environment: paddle.environment,
        }
      : null

    if (eventType === 'transaction.completed') {
      const userId = user?.id || null
      const transactionSubscriptionId = getTransactionSubscriptionId(payload)
      const transactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null
      const completedPlanChange = getPlanChangeMetadata(payload)
      const isRecoveredPlanChange = isSubscriptionUpdateTransaction(payload) && completedPlanChange?.outcome === 'recovered'

      if (!hasEnvironmentMismatch && !isRecoveredPlanChange) {
        if (userId) {
          await pool.query(
            `UPDATE users
             SET subscription_status = 'active',
                 subscription_started_at = COALESCE(subscription_started_at, NOW()),
                 trial_consumed_at = COALESCE(trial_consumed_at, NOW()),
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 paddle_customer_id = COALESCE($3, paddle_customer_id),
                 subscription_plan = COALESCE($4, subscription_plan),
                 current_period_end = COALESCE($5, current_period_end),
                 next_billing_date = COALESCE($6, next_billing_date),
                 paddle_environment = $7,
                 updated_at = NOW()
             WHERE id = $1`,
            [userId, transactionSubscriptionId, getPaddleCustomerId(payload), getStoredSubscriptionPlan(payload, paddle), payload?.data?.billing_period?.ends_at || null, payload?.data?.billing_period?.ends_at || null, paddle.environment],
          )
        }

        await markPaymentAttemptSucceeded(payload)

        await trackEvent({
          userId,
          eventType: 'payment_success',
          metadata: {
            source: 'paddle.webhook',
            transaction_id: payload?.data?.id || null,
            plan: payload?.data?.custom_data?.plan || null,
            amount: getPaymentAmount(payload),
            currency: payload?.data?.currency_code || payload?.data?.currency || null,
          },
        })

        await triggerWebhook('subscription.activated', {
          userId,
          subscriptionId: transactionSubscriptionId,
          transactionId,
          status: 'active',
        })
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
        }
      }

      if (!hasEnvironmentMismatch && !preservePaidPlan && shouldApplyFailedPaymentToUser(user, payload, eventType)) {
        await pool.query(
          `UPDATE users
           SET subscription_status = $2,
               paddle_subscription_id = COALESCE($3, paddle_subscription_id),
               paddle_customer_id = COALESCE($4, paddle_customer_id),
               subscription_plan = COALESCE($5, subscription_plan),
               current_period_end = COALESCE($6, current_period_end),
               next_billing_date = COALESCE($7, next_billing_date),
               paddle_environment = $8,
               updated_at = NOW()
           WHERE id = $1`,
          [
            user.id,
            nextStatus || 'payment_failed',
            getTransactionSubscriptionId(payload),
            getPaddleCustomerId(payload),
            getStoredSubscriptionPlan(payload, paddle),
            payload?.data?.billing_period?.ends_at || payload?.data?.current_billing_period?.ends_at || null,
            payload?.data?.billing_period?.ends_at || payload?.data?.next_billed_at || null,
            paddle.environment,
          ],
        )
      }

      try {
        await recordFailedPaymentAttempt(payload, null, paddle.environment)
      } catch (error) {
        const transactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null
        const failedSubscriptionId = getTransactionSubscriptionId(payload)
        const context = {
          eventType,
          transactionId,
          customerId: getPaddleCustomerId(payload),
          userId: user?.id || null,
          subscriptionId: failedSubscriptionId,
          error: getSafeErrorContext(error),
        }
        console.error('[Paddle webhook] payment.failure.record_failed', context)
        await logErrorToDatabase('payment.failure.record_failed', error, context)
      }

      await trackEvent({
        userId: user?.id || null,
        eventType: 'payment_fail',
        metadata: {
          source: 'paddle.webhook',
          transaction_id: payload?.data?.id || null,
          plan: payload?.data?.custom_data?.plan || null,
          amount: getPaymentAmount(payload),
          currency: payload?.data?.currency_code || payload?.data?.currency || null,
        },
      })
    }

    if (!hasEnvironmentMismatch && (eventType === 'subscription.created' || eventType === 'subscription.updated' || eventType === 'subscription.trialing')) {
      const updatedStatus = getSubscriptionStatus(payload) || mapToSubscriptionStatus(eventType, payload)
      const subscriptionFromEvent = getSubscriptionId(payload)
      let preservePaidPlan = eventType === 'subscription.updated' && shouldPreservePaidPlanDuringUpdate(user, payload, paddle, eventType)

      if (preservePaidPlan && getPlanChangeMetadata(payload) && String(updatedStatus || '').toLowerCase() === 'past_due') {
        const recovery = await recoverFailedPlanChangeFromWebhook(user, payload, paddle)
        preservePaidPlan = recovery.outcome === PLAN_CHANGE_RECOVERY_OUTCOME.RECOVERED
        subscriptionProjection = recoveredSubscriptionProjection(subscriptionProjection, recovery)
      } else if (preservePaidPlan) {
        subscriptionProjection = null
      }

      if (user?.id && updatedStatus && !preservePaidPlan) {
        await pool.query(
          `UPDATE users
           SET paddle_subscription_id = COALESCE($2, paddle_subscription_id),
               subscription_status = $3,
               paddle_customer_id = COALESCE($4, paddle_customer_id),
               subscription_plan = COALESCE($5, subscription_plan),
               current_period_end = COALESCE($6, current_period_end),
               next_billing_date = COALESCE($7, next_billing_date),
               paddle_environment = $8,
               cancellation_effective_at = CASE
                 WHEN $9::timestamp IS NOT NULL THEN $9::timestamp
                 WHEN $3 IN ('active', 'trialing') THEN NULL
                 ELSE cancellation_effective_at
               END,
               subscription_started_at = CASE WHEN $3 IN ('active', 'trialing') THEN COALESCE(subscription_started_at, NOW()) ELSE subscription_started_at END,
               trial_consumed_at = CASE WHEN $3 IN ('active', 'trialing') THEN COALESCE(trial_consumed_at, NOW()) ELSE trial_consumed_at END,
               updated_at = NOW()
           WHERE id = $1`,
          [user.id, subscriptionFromEvent, updatedStatus, getPaddleCustomerId(payload), getStoredSubscriptionPlan(payload, paddle), payload?.data?.current_billing_period?.ends_at || null, payload?.data?.next_billed_at || payload?.data?.current_billing_period?.ends_at || null, paddle.environment, getScheduledCancellationEffectiveAt(payload)],
        )
      }
    }

    if (!hasEnvironmentMismatch && (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled')) {
      const canceledSubscriptionId = getSubscriptionId(payload, eventType)

      if (user?.id) {
        await pool.query(
          `UPDATE users
           SET subscription_status = 'cancelled',
               paddle_subscription_id = COALESCE($2, paddle_subscription_id),
               paddle_customer_id = COALESCE($3, paddle_customer_id),
               current_period_end = COALESCE($4, current_period_end),
               subscription_renewal_date = NULL,
               next_billing_date = NULL,
               cancellation_effective_at = COALESCE($5, cancellation_effective_at, $4, NOW()),
               paddle_environment = $6,
               updated_at = NOW()
           WHERE id = $1`,
          [
            user.id,
            canceledSubscriptionId,
            getPaddleCustomerId(payload),
            payload?.data?.current_billing_period?.ends_at || null,
            payload?.data?.canceled_at || payload?.data?.scheduled_change?.effective_at || payload?.data?.current_billing_period?.ends_at || null,
            paddle.environment,
          ],
        )
      }

      await trackEvent({
        userId: user?.id || null,
        eventType: 'cancellation',
        metadata: {
          source: 'paddle.webhook',
          subscription_id: canceledSubscriptionId,
        },
      })
    }

    if (subscriptionProjection) {
      await upsertSubscriptionProjection(subscriptionProjection)
    }

    await pool.query(
      `INSERT INTO paddle_webhook_events (event_id, event_type, payload_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING`,
      [dedupeEventId, eventType || 'unknown', payloadHash],
    )
  } catch (error) {
    console.error('[Paddle webhook] failed to update subscription state', error)
    await logErrorToDatabase('paddle.webhook.processing_failed', error, { eventType, payload })
    return res.status(500).json({ error: 'Webhook processing failed' })
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

const rawJsonBody = express.raw({ type: 'application/json' })

// Keep the legacy endpoint bound to PADDLE_ENVIRONMENT for existing live
// notification destinations. Explicit endpoints allow live and sandbox events
// to coexist safely in the same production deployment.
router.post('/', rawJsonBody, createPaddleWebhookHandler())
router.post('/production', rawJsonBody, createPaddleWebhookHandler('production'))
router.post('/sandbox', rawJsonBody, createPaddleWebhookHandler('sandbox'))

export default router
