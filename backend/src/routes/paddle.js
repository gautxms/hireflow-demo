import express from 'express'
import {
  createSubscriptionSession,
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

router.post('/checkout-session', express.json(), async (req, res) => {
  try {
    const { user = null, planId } = req.body || {}
    const session = await createSubscriptionSession(user, planId)

    return res.status(200).json(session)
  } catch (error) {
    console.error('Paddle checkout session creation failed:', error)

    return res.status(500).json({
      error: 'Unable to create checkout session.',
    })
  }
})

router.post('/confirm', express.json(), async (req, res) => {
  const { planId, transactionId, status } = req.body || {}

  // Future logic: validate transaction with Paddle API and persist
  // subscription/account state in the database.
  return res.status(200).json({
    provider: 'paddle',
    planId: planId || null,
    transactionId: transactionId || null,
    status: status === 'success' ? 'active' : 'pending',
    confirmed: status === 'success',
  })
})

export default router
