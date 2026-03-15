import { Router } from 'express'
import { pool } from '../db/client.js'
import { getFailedPaymentsForAdmin } from '../services/paymentRetry.js'

const router = Router()

function getMonthStart(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

router.get('/users', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, subscription_status, paddle_subscription_id, created_at
       FROM users
       ORDER BY created_at DESC`,
    )

    return res.json(result.rows)
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/usage-overrides', async (req, res) => {
  const { userId, monthStart, uploadLimit, resetUsage = false, note = null } = req.body || {}

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  const normalizedMonthStart = getMonthStart(monthStart)

  try {
    const result = await pool.query(
      `INSERT INTO usage_overrides (user_id, month_start, upload_limit, reset_usage, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, month_start)
       DO UPDATE SET upload_limit = EXCLUDED.upload_limit,
                     reset_usage = EXCLUDED.reset_usage,
                     note = EXCLUDED.note,
                     updated_at = NOW()
       RETURNING id, user_id, month_start, upload_limit, reset_usage, note, updated_at`,
      [userId, normalizedMonthStart, uploadLimit, resetUsage, note],
    )

    return res.status(200).json({
      ok: true,
      message: 'Usage override saved. resetUsage=true will reset counted usage for the selected month.',
      override: result.rows[0],
    })
  } catch (error) {
    console.error('[Admin] Failed to upsert usage override:', error)
    return res.status(500).json({ error: 'Unable to save usage override' })
  }
})

router.delete('/usage-overrides/:userId', async (req, res) => {
  const { userId } = req.params
  const monthStart = getMonthStart(req.query.monthStart)

  try {
    const result = await pool.query(
      `DELETE FROM usage_overrides
       WHERE user_id = $1 AND month_start = $2
       RETURNING id`,
      [userId, monthStart],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No override found for user/month' })
    }

    return res.status(200).json({ ok: true, message: 'Usage override removed' })
  } catch (error) {
    console.error('[Admin] Failed to clear usage override:', error)
    return res.status(500).json({ error: 'Unable to clear usage override' })
  }
})

export default router
