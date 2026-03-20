import { Router } from 'express'
import { pool } from '../db/client.js'

const router = Router()

function getMonthStart(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

router.get('/users', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, email, subscription_status, paddle_subscription_id, created_at
       FROM users
       ORDER BY created_at DESC`,
    )

    return res.json(result.rows)
  } catch (error) {
    return next(error)
  }
})

router.get('/errors/dashboard', async (_req, res, next) => {
  try {
    const recentErrors = await pool.query(
      `SELECT id, error_type, endpoint, method, status_code, message, created_at, alert_sent
       FROM error_logs
       WHERE archived_at IS NULL
       ORDER BY created_at DESC
       LIMIT 100`,
    )

    const groupedErrors = await pool.query(
      `SELECT error_type,
              endpoint,
              COUNT(*)::int AS occurrences,
              MAX(created_at) AS latest_seen
       FROM error_logs
       WHERE archived_at IS NULL
       GROUP BY error_type, endpoint
       ORDER BY occurrences DESC, latest_seen DESC
       LIMIT 50`,
    )

    return res.json({
      recent: recentErrors.rows,
      grouped: groupedErrors.rows,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/errors/test-500', (_req, _res, next) => {
  const error = new Error('Intentional test error for monitoring validation')
  error.statusCode = 500
  next(error)
})

router.post('/usage-overrides', async (req, res, next) => {
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
    return next(error)
  }
})

router.delete('/usage-overrides/:userId', async (req, res, next) => {
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
    return next(error)
  }
})

export default router
