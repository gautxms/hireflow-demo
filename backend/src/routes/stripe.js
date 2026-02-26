import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { requirePaymentsEnabled } from '../middleware/paymentsEnabled.js'
import { stripe } from '../services/stripe.js'

const router = Router()

/**
 * Frontend-backend contract (future-ready):
 * POST /api/stripe/create-subscription
 * Auth: Authorization: Bearer <JWT>
 * Body: { paymentMethodId: string }
 * Success response shape: { status: "trialing" | "active", trial_end: ISO timestamp }
 */

router.post('/create-subscription', requireAuth, requirePaymentsEnabled, (_req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payments not enabled yet' })
  }

  return res.status(503).json({ error: 'Payments not enabled yet' })
})

export default router
