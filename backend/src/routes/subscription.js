import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { signToken, TOKEN_TYPES } from '../utils/jwt.js'

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

function setFullAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
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

    const isActive = isSubscriptionActive(user.stripe_status, user.trial_end)

    const responseBody = {
      stripe_status: user.stripe_status,
      trial_end: user.trial_end,
      is_active: isActive,
    }

    // When a signup temp token hits active/trial state, upgrade to full JWT.
    if (isActive && req.auth?.tokenType === TOKEN_TYPES.TEMP) {
      const token = signToken(req.userId)
      setFullAuthCookie(res, token)
      responseBody.token = token
    }

    return res.json(responseBody)
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
