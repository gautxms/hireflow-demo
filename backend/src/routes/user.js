import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT stripe_status, trial_end
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const stripeStatus = user.stripe_status || null
    const trialEnd = user.trial_end || null
    const trialStillValid = trialEnd ? new Date(trialEnd) > new Date() : false
    const isActive = stripeStatus === 'active' || stripeStatus === 'trialing' || trialStillValid

    return res.json({
      stripe_status: stripeStatus,
      trial_end: trialEnd,
      is_active: isActive,
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
