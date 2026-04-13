import crypto from 'crypto'
import express from 'express'
import { pool, logErrorToDatabase } from '../db/client.js'
import { recordFailedPaymentAttempt } from '../services/paymentRetry.js'
import { trackEvent } from '../services/analytics.js'
import { triggerWebhook } from '../services/webhookService.js'
import {
  getWebhookEventType,
  mapToSubscriptionStatus,
  verifyPaddleSignature,
  getEventDeduplicationId,
} from '../utils/paddleWebhook.js'

const router = express.Router()

function getPaddleCustomerId(payload) {
  return (
    payload?.data?.customer_id ||
    payload?.data?.customer?.id ||
    payload?.customer_id ||
    payload?.customer?.id ||
    null
  )
}

function getSubscriptionId(payload) {
  return payload?.data?.id || payload?.subscription_id || payload?.subscription?.id || null
}

function getSubscriptionStatus(payload) {
  return payload?.data?.status || payload?.status || null
}

async function resolveUserFromPayload(payload) {
  const explicitUserId = payload?.data?.custom_data?.userId || payload?.custom_data?.userId || null

  if (explicitUserId) {
    const result = await pool.query(
      `SELECT id, paddle_customer_id FROM users WHERE id = $1 LIMIT 1`,
      [explicitUserId],
    )

    return result.rows[0] || null
  }

  const paddleCustomerId = getPaddleCustomerId(payload)

  if (!paddleCustomerId) {
    return null
  }

  const result = await pool.query(
    `SELECT id, paddle_customer_id FROM users WHERE paddle_customer_id = $1 LIMIT 1`,
    [paddleCustomerId],
  )

  return result.rows[0] || null
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

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : ''
  const secret = process.env.PADDLE_WEBHOOK_SECRET || ''
  const incomingSignature = req.headers['paddle-signature']
  const signatureHeader = typeof incomingSignature === 'string' ? incomingSignature : req.get('Paddle-Signature')

  let payload

  try {
    payload = JSON.parse(rawBody || '{}')
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' })
  }

  const eventType = getWebhookEventType(payload)
  const signatureCheck = verifyPaddleSignature(rawBody, signatureHeader, secret)

  try {
    await logWebhookAudit(eventType, payload, signatureCheck.isValid, signatureCheck.reason)
  } catch (error) {
    console.error('[Paddle webhook] failed to write audit log', error)
  }

  if (!signatureCheck.isValid) {
    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  try {
    await ensureWebhookEventsTable()

    const dedupeEventId = getEventDeduplicationId(payload, rawBody)
    const payloadHash = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex')

    const dedupeResult = await pool.query(
      `INSERT INTO paddle_webhook_events (event_id, event_type, payload_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [dedupeEventId, eventType || 'unknown', payloadHash],
    )

    if (dedupeResult.rowCount === 0) {
      return res.status(200).json({ received: true, duplicate: true })
    }

    const nextStatus = mapToSubscriptionStatus(eventType, payload)
    const subscriptionId = getSubscriptionId(payload)
    const user = await resolveUserFromPayload(payload)

    if (nextStatus && subscriptionId) {
      await pool.query(
        `INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (paddle_subscription_id)
         DO UPDATE SET
           user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
           status = EXCLUDED.status,
           latest_event_type = EXCLUDED.latest_event_type,
           latest_event_payload = EXCLUDED.latest_event_payload,
           updated_at = NOW()`,
        [subscriptionId, user?.id || null, nextStatus, eventType, JSON.stringify(payload)],
      )
    }

    if (eventType === 'transaction.completed') {
      const userId = user?.id || null
      const transactionSubscriptionId = getSubscriptionId(payload)
      const transactionId = payload?.data?.id || payload?.transaction_id || payload?.id || null

      if (userId) {
        await pool.query(
          `UPDATE users
           SET subscription_status = 'active',
               subscription_started_at = COALESCE(subscription_started_at, NOW()),
               paddle_subscription_id = COALESCE($2, paddle_subscription_id),
               updated_at = NOW()
           WHERE id = $1`,
          [userId, transactionSubscriptionId],
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

    if (eventType === 'transaction.failed' || eventType === 'transaction.payment_failed') {
      await recordFailedPaymentAttempt(payload)

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

    if (eventType === 'subscription.created' || eventType === 'subscription.updated' || eventType === 'subscription.trialing') {
      const updatedStatus = getSubscriptionStatus(payload) || mapToSubscriptionStatus(eventType, payload)
      const subscriptionFromEvent = getSubscriptionId(payload)

      if (user?.id && updatedStatus) {
        await pool.query(
          `UPDATE users
           SET paddle_subscription_id = COALESCE($2, paddle_subscription_id),
               subscription_status = $3,
               subscription_started_at = CASE WHEN $3 IN ('active', 'trialing') THEN COALESCE(subscription_started_at, NOW()) ELSE subscription_started_at END,
               updated_at = NOW()
           WHERE id = $1`,
          [user.id, subscriptionFromEvent, updatedStatus],
        )
      }
    }

    if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') {
      const canceledSubscriptionId = getSubscriptionId(payload)

      if (user?.id) {
        await pool.query(
          `UPDATE users
           SET subscription_status = 'cancelled',
               paddle_subscription_id = COALESCE($2, paddle_subscription_id),
               updated_at = NOW()
           WHERE id = $1`,
          [user.id, canceledSubscriptionId],
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
  } catch (error) {
    console.error('[Paddle webhook] failed to update subscription state', error)
    await logErrorToDatabase('paddle.webhook.processing_failed', error, { eventType, payload })
    return res.status(500).json({ error: 'Webhook processing failed' })
  }

  return res.status(200).json({ received: true })
})

export default router
