import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

function isSubscriptionActive(stripeStatus, trialEnd) {
  const normalizedStatus = typeof stripeStatus === 'string'
    ? stripeStatus.trim().toLowerCase()
    : ''

  if (normalizedStatus === 'active' || normalizedStatus === 'trialing') {
    return true
  }

  if (!trialEnd) {
    return false
  }

  const trialEndDate = new Date(trialEnd)
  if (Number.isNaN(trialEndDate.getTime())) {
    return false
  }

  return trialEndDate > new Date()
}

router.get('/status', requireAuth, async (req, res) => {
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

    return res.json({
      stripe_status: user.stripe_status,
      trial_end: user.trial_end,
      is_active: isSubscriptionActive(user.stripe_status, user.trial_end),
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
