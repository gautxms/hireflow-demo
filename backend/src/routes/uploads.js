import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.post('/', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT subscription_status FROM users WHERE id = $1',
      [req.userId]
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.subscription_status !== 'active') {
      return res.status(403).json({
        error: 'Subscription required',
        message: 'Your trial has expired or subscription is inactive. Please upgrade to continue.',
      })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[Uploads] failed subscription check', error)
    return res.status(500).json({ error: 'Unable to process upload request' })
  }
})

export default router
