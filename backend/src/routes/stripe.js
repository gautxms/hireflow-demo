import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { requirePaymentsEnabled } from '../middleware/paymentsEnabled.js'

const router = Router()

// Route-level guard applied to all Stripe endpoints in this router.
router.use(requirePaymentsEnabled)
router.use(requireAuth)

router.get('/status', (_req, res) => {
  res.json({ paymentsEnabled: true })
})

export default router
