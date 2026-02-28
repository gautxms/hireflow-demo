import express from 'express'
import {
  verifyPaddleWebhookSignature,
  handlePaddleWebhookEvent,
} from '../services/paddle.js'

const router = express.Router()

// Paddle classic webhooks are sent as form-encoded payloads.
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  const eventPayload = req.body || {}
  const signature = eventPayload.p_signature

  const isVerified = verifyPaddleWebhookSignature(eventPayload, signature)

  if (!isVerified) {
    return res.status(401).json({
      error: 'Invalid Paddle webhook signature.',
    })
  }

  try {
    const result = await handlePaddleWebhookEvent(eventPayload)

    // We always acknowledge validly signed requests to avoid webhook retries.
    // Future business logic can branch on `result.processed` and enqueue jobs.
    return res.status(200).json({
      ok: true,
      result,
    })
  } catch (error) {
    console.error('Paddle webhook handling failed:', error)

    return res.status(500).json({
      error: 'Webhook processing failed.',
    })
  }
})

export default router
