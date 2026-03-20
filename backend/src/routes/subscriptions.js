import { Router } from 'express'
import { pool } from '../db/client.js'
import { sendCancellationEmail } from '../services/emailService.js'

const router = Router()

router.post('/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users
       SET subscription_status = 'inactive'
       WHERE id = $1
       RETURNING email`,
      [req.userId],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const endsOn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await sendCancellationEmail({ to: user.email, endsOn })

    return res.json({ success: true, endsOn })
  } catch (error) {
    console.error('[SUBSCRIPTIONS] Failed to cancel subscription', error)
    return res.status(500).json({ error: 'Failed to cancel subscription' })
  }
})

export default router
