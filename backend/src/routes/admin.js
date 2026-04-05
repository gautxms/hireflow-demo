import { Router } from 'express'
import { pool } from '../db/client.js'
import { getFailedPaymentsForAdmin } from '../services/paymentRetry.js'
import { getRateLimitStats } from '../middleware/rateLimiter.js'

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


router.get('/rate-limit-stats', (_req, res) => {
  return res.json(getRateLimitStats())
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

router.get('/actions', async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '100'), 10) || 100))
  const adminId = req.query.adminId ? String(req.query.adminId) : null
  const actionType = req.query.actionType ? String(req.query.actionType) : null

  const params = [limit]
  const where = []

  if (adminId) {
    params.push(adminId)
    where.push(`admin_id::text = $${params.length}`)
  }

  if (actionType) {
    params.push(actionType)
    where.push(`action_type = $${params.length}`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const result = await pool.query(
      `SELECT id, admin_id, action_type, target_id, details, ip_address, created_at
       FROM admin_actions
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    )

    return res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        actionType: row.action_type,
        targetId: row.target_id,
        details: row.details || {},
        ipAddress: row.ip_address,
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    console.error('[Admin] Failed to query admin actions:', error)
    return res.status(500).json({ error: 'Unable to query admin actions' })
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
