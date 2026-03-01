import crypto from 'crypto'
import { Router } from 'express'
import { pool } from '../db/client.js'

const router = Router()

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

function getSubscriptionId(payload) {
  return payload?.data?.id || payload?.subscription_id || payload?.subscription?.id || null
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

async function logWebhookAudit(eventType, payload, isValidSignature, errorMessage = null) {
  await pool.query(
    `INSERT INTO paddle_webhook_audit (event_type, payload, signature_valid, error_message)
     VALUES ($1, $2::jsonb, $3, $4)`,
    [eventType || 'unknown', JSON.stringify(payload), isValidSignature, errorMessage],
  )
}

router.post('/webhook', async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : ''

  let payload

  try {
    payload = JSON.parse(rawBody || '{}')
  } catch {
    payload = { rawBody }
  }

  const eventType = getWebhookEventType(payload)
  const signatureHeader = req.get('Paddle-Signature')
  const isValidSignature = verifyPaddleSignature(
    rawBody,
    signatureHeader,
    process.env.PADDLE_WEBHOOK_SECRET,
  )

  console.log('[Paddle webhook] event received', {
    eventType,
    signatureValid: isValidSignature,
  })

  try {
    await logWebhookAudit(eventType, payload, isValidSignature, isValidSignature ? null : 'Invalid signature')
  } catch (error) {
    console.error('[Paddle webhook] failed to write audit log', error)
  }

  if (!isValidSignature) {
    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  const nextStatus = mapToSubscriptionStatus(eventType, payload)
  const subscriptionId = getSubscriptionId(payload)

  if (!nextStatus || !subscriptionId) {
    return res.status(200).json({ received: true, ignored: true })
  }

  try {
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

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('[Paddle webhook] failed to update subscription state', error)

    try {
      await logWebhookAudit(eventType, payload, true, 'Failed to upsert subscription')
    } catch {
      // noop
    }

    return res.status(500).json({ error: 'Failed to process webhook' })
  }
})

export default router
