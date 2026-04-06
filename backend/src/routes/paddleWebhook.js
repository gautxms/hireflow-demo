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

  let normalizedSecret = secret.trim()

  try {
    const decodedSecret = Buffer.from(normalizedSecret, 'base64')
    const reEncodedSecret = decodedSecret.toString('base64').replace(/=+$/, '')
    const normalizedBase64Input = normalizedSecret.replace(/=+$/, '')

    if (decodedSecret.length > 0 && reEncodedSecret === normalizedBase64Input) {
      normalizedSecret = decodedSecret
      console.log('[Paddle] Using base64-decoded webhook secret')
    }
  } catch {
    // noop - falls back to raw secret
  }

  const signedPayload = `${parsed.ts}:${rawBody}`
  const expected = crypto
    .createHmac('sha256', normalizedSecret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  console.log('[Paddle] Expected signature (first 16):', expected.substring(0, 16))
  console.log('[Paddle] Received signature (first 16):', parsed.h1.substring(0, 16))

  return safeCompareHex(expected, parsed.h1)
}

function getWebhookEventType(payload) {
  return payload?.event_type || payload?.eventType || payload?.alert_name || null
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

function getSubscriptionPlan(payload) {
  const frequency = payload?.data?.billing_cycle?.frequency || payload?.billing_cycle?.frequency || null

  if (frequency === 'year') {
    return 'annual'
  }

  if (frequency === 'month') {
    return 'monthly'
  }

  return null
}

function getSubscriptionId(payload) {
  return payload?.data?.id || payload?.subscription_id || payload?.subscription?.id || null
}

function getSubscriptionStatus(payload) {
  return payload?.data?.status || payload?.status || null
}

function mapToSubscriptionStatus(eventType, payload) {
  const normalizedEventType = eventType ? String(eventType).toLowerCase() : ''

  if (normalizedEventType === 'subscription.created' || normalizedEventType === 'subscription_created') {
    const paddleStatus = payload?.data?.status || payload?.status

    if (paddleStatus === 'trialing') {
      return 'trialing'
    }

    return paddleStatus || 'active'
  }

  if (normalizedEventType === 'subscription.updated' || normalizedEventType === 'subscription_updated') {
    return payload?.data?.status || payload?.status || null
  }

  if (normalizedEventType === 'subscription.canceled' || normalizedEventType === 'subscription.cancelled' || normalizedEventType === 'subscription_cancelled') {
    return 'cancelled'
  }

  if (normalizedEventType === 'transaction.completed' || normalizedEventType === 'subscription_payment_succeeded') {
    return 'active'
  }

  return null
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

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : ''
  const secret = process.env.PADDLE_WEBHOOK_SECRET || ''
  const incomingSignature = req.headers['paddle-signature']

  console.log('[Paddle] Secret length:', secret?.length)
  console.log('[Paddle] Secret first 10 chars:', secret?.substring(0, 10))
  console.log('[Paddle] Incoming signature:', incomingSignature)
  console.log('[Paddle] Body hash attempt:', crypto.createHash('sha256').update(rawBody).digest('hex'))

  let payload

  try {
    payload = JSON.parse(rawBody || '{}')
  } catch {
    payload = { rawBody }
  }

  const eventType = getWebhookEventType(payload)
  const signatureHeader = typeof incomingSignature === 'string' ? incomingSignature : req.get('Paddle-Signature')
  const isValidSignature = verifyPaddleSignature(
    rawBody,
    signatureHeader,
    secret,
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
        const user = await resolveUserFromPayload(payload)
        const userId = user?.id || null
        const transactionSubscriptionId = getSubscriptionId(payload)
        const transactionPlan = getSubscriptionPlan(payload)

        if (userId) {
          await pool.query(
            `UPDATE users
             SET subscription_status = 'active',
                 subscription_started_at = COALESCE(subscription_started_at, NOW()),
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 subscription_plan = COALESCE($3, subscription_plan),
                 updated_at = NOW()
             WHERE id = $1`,
            [userId, transactionSubscriptionId, transactionPlan],
          )
          console.log('[Webhook] Updated user subscription:', { userId, status: 'active' })
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
          userId: (await resolveUserFromPayload(payload))?.id || null,
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
        const user = await resolveUserFromPayload(payload)
        const createdSubscriptionId = getSubscriptionId(payload)
        const createdStatus = mapToSubscriptionStatus(eventType, payload) || 'active'
        const createdPlan = getSubscriptionPlan(payload)

        if (user?.id && createdSubscriptionId) {
          await pool.query(
            `UPDATE users
             SET paddle_subscription_id = $2,
                 subscription_status = $3,
                 subscription_plan = COALESCE($4, subscription_plan),
                 subscription_started_at = COALESCE(subscription_started_at, NOW()),
                 updated_at = NOW()
             WHERE id = $1`,
            [user.id, createdSubscriptionId, createdStatus, createdPlan],
          )
          console.log('[Webhook] Updated user subscription:', { userId: user.id, status: createdStatus })
        }
      }

      if (eventType === 'subscription.updated') {
        const user = await resolveUserFromPayload(payload)
        const updatedStatus = getSubscriptionStatus(payload)
        const updatedPlan = getSubscriptionPlan(payload)

        if (user?.id && updatedStatus) {
          await pool.query(
            `UPDATE users
             SET subscription_status = $2,
                 subscription_plan = COALESCE($3, subscription_plan),
                 updated_at = NOW()
             WHERE id = $1`,
            [user.id, updatedStatus, updatedPlan],
          )
          console.log('[Webhook] Updated user subscription:', { userId: user.id, status: updatedStatus })
        }
      }

      if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') {
        const user = await resolveUserFromPayload(payload)
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
          console.log('[Webhook] Updated user subscription:', { userId: user.id, status: 'cancelled' })
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
    } else {
      console.warn('[Paddle] ✗ Webhook signature invalid')
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

  if (isValidSignature) {
    console.log('[Paddle] ✓ Webhook signature valid')
  }

  return res.status(200).json({ received: true })
})

export default router
