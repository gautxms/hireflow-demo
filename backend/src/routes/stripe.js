import express from 'express'

const router = express.Router()

const isStripeEnabled = () => process.env.STRIPE_ENABLED === 'true'

const hasStripeKeys = () => Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.STRIPE_WEBHOOK_SECRET)

router.post('/webhook', (_req, res) => {
  // Pre-approval stub endpoint: this route intentionally blocks Stripe processing
  // until account approval is complete and production webhook handling is implemented.
  if (!isStripeEnabled() || !hasStripeKeys()) {
    return res.status(503).json({
      error: 'Stripe webhook unavailable',
      message: 'Stripe is disabled or missing required keys.',
    })
  }

  // Pre-approval stub: no business logic, no subscription updates, no side effects.
  return res.status(202).json({
    received: true,
    message: 'Stripe webhook stub active. Processing will be added after Stripe approval.',
  })
})

export default router
