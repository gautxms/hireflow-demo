import crypto from 'crypto'
import express from 'express'
import { pool, logErrorToDatabase } from '../db/client.js'
import { recordFailedPaymentAttempt } from '../services/paymentRetry.js'
import { trackEvent } from '../services/analytics.js'

const router = express.Router()

function parseSignatureHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return null
  }

  return headerValue.split(';').reduce((acc, part) => {
    const [key, value] = part.split('=').map((item) => item.trim())

    if (key && value) {
      acc[key] = value
    }

    return acc
  }, {})
}

function safeCompareHex(expectedHex, receivedHex) {
  const expectedBuffer = Buffer.from(expectedHex, 'hex')
  const receivedBuffer = Buffer.from(receivedHex, 'hex')

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}

function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  const parsed = parseSignatureHeader(signatureHeader)

  if (!parsed?.ts || !parsed?.h1 || !secret) {
    return false
  }

  const signedPayload = `${parsed.ts}:${rawBody}`
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  return safeCompareHex(expected, parsed.h1)
}

function getWebhookEventType(payload) {
  return payload?.event_type || payload?.eventType || payload?.alert_name || null
}

function getCustomerEmail(payload) {
  return (
    payload?.data?.customer?.email ||
    payload?.data?.email ||
    payload?.customer_email ||
    payload?.email ||
    null
  )
}

function getSubscriptionId(payload) {
  return payload?.data?.id || payload?.subscription_id || payload?.subscription?.id || null
}

function getSubscriptionStatus(payload) {
  return payload?.data?.status || payload?.status || null
}

function mapToSubscriptionStatus(eventType, payload) {
  if (eventType === 'subscription_created') {
    const paddleStatus = payload?.data?.status || payload?.status

    if (paddleStatus === 'trialing') {
      return 'trialing'
    }

    return 'active'
  }

  if (eventType === 'subscription_payment_succeeded') {
    return 'active'
  }

  if (eventType === 'subscription_cancelled') {
    return 'cancelled'
  }

  return null
}



async function resolveUserIdFromPayload(payload) {
  const explicitUserId = payload?.data?.custom_data?.userId || payload?.custom_data?.userId || null

  if (explicitUserId) {
    return explicitUserId
  }

  const email = getCustomerEmail(payload)

  if (!email) {
    return null
  }

  const result = await pool.query(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email],
  )

  return result.rows[0]?.id || null
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

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : ''

  let payload

  try {
    payload = JSON.parse(rawBody || '{}')
  } catch {
    payload = { rawBody }
  }

  const eventType = req.body?.event_type || getWebhookEventType(payload)
  const signatureHeader = req.get('Paddle-Signature')
  const isValidSignature = verifyPaddleSignature(
    rawBody,
    signatureHeader,
    process.env.PADDLE_WEBHOOK_SECRET,
  )

  console.log('[PADDLE EVENT]', eventType)

  console.log('[Paddle webhook] event received', {
    eventType,
    signatureValid: isValidSignature,
  })

  try {
    await logWebhookAudit(eventType, payload, isValidSignature, isValidSignature ? null : 'Invalid signature')
  } catch (error) {
    console.error('[Paddle webhook] failed to write audit log', error)
  }

  try {
    if (isValidSignature) {
      const nextStatus = mapToSubscriptionStatus(eventType, payload)
      const subscriptionId = getSubscriptionId(payload)

      if (nextStatus && subscriptionId) {
        await pool.query(
          `INSERT INTO subscriptions (paddle_subscription_id, status, latest_event_type, latest_event_payload)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (paddle_subscription_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             latest_event_type = EXCLUDED.latest_event_type,
             latest_event_payload = EXCLUDED.latest_event_payload,
             updated_at = NOW()`,
          [subscriptionId, nextStatus, eventType, JSON.stringify(payload)],
        )
      }

      if (eventType === 'transaction.completed') {
        const userId = await resolveUserIdFromPayload(payload)
        const email = getCustomerEmail(payload)

        if (userId) {
          await pool.query(
            `UPDATE users
             SET subscription_status = 'active', updated_at = NOW()
             WHERE id = $1`,
            [userId],
          )
          console.log('[PADDLE] Activated subscription for user:', userId)
        } else if (email) {
          await pool.query(
            `UPDATE users
             SET subscription_status = 'active', updated_at = NOW()
             WHERE email = $1`,
            [email],
          )
          console.log('[PADDLE] Activated subscription for email:', email)
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
      }

      if (eventType === 'transaction.failed') {
        await recordFailedPaymentAttempt(payload)

        await trackEvent({
          userId: await resolveUserIdFromPayload(payload),
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

      if (eventType === 'subscription.created') {
        const email = getCustomerEmail(payload)
        const createdSubscriptionId = getSubscriptionId(payload)

        if (email && createdSubscriptionId) {
          await pool.query(
            `UPDATE users
             SET paddle_subscription_id = $1,
                 subscription_status = COALESCE(subscription_status, 'active'),
                 updated_at = NOW()
             WHERE email = $2`,
            [createdSubscriptionId, email],
          )
        }
      }

      if (eventType === 'subscription.updated') {
        const updatedSubscriptionId = getSubscriptionId(payload)
        const updatedStatus = getSubscriptionStatus(payload)

        if (updatedSubscriptionId && updatedStatus) {
          await pool.query(
            `UPDATE users
             SET subscription_status = $1, updated_at = NOW()
             WHERE paddle_subscription_id = $2`,
            [updatedStatus, updatedSubscriptionId],
          )
        }
      }

      if (eventType === 'subscription.canceled') {
        const canceledSubscriptionId = getSubscriptionId(payload)

        if (canceledSubscriptionId) {
          await pool.query(
            `UPDATE users
             SET subscription_status = 'inactive', updated_at = NOW()
             WHERE paddle_subscription_id = $1`,
            [canceledSubscriptionId],
          )
        }

        await trackEvent({
          userId: await resolveUserIdFromPayload(payload),
          eventType: 'cancellation',
          metadata: {
            source: 'paddle.webhook',
            subscription_id: canceledSubscriptionId,
          },
        })
      }
    } else {
      console.warn('[Paddle webhook] invalid signature')
    }
  } catch (error) {
    console.error('[Paddle webhook] failed to update subscription state', error)
    await logErrorToDatabase('paddle.webhook.processing_failed', error, { eventType, payload })

    try {
      await logWebhookAudit(eventType, payload, true, 'Failed to upsert subscription')
    } catch {
      // noop
    }

  }

  return res.status(200).json({ received: true })
})

export default router
