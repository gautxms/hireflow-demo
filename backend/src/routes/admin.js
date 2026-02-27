import { Router } from 'express'
import { pool } from '../db/client.js'

const router = Router()

router.get('/users', async (req, res) => {
  const page = Number.parseInt(req.query.page, 10) || 1
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 10, 100)
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
  const offset = (Math.max(page, 1) - 1) * limit

  const whereClause = search ? 'WHERE LOWER(email) LIKE $1' : ''
  const params = search ? [`%${search}%`, limit, offset] : [limit, offset]
  const limitIndex = search ? 2 : 1
  const offsetIndex = search ? 3 : 2

  try {
    const usersResult = await pool.query(
      `SELECT id, email, role, is_blocked, blocked_reason, blocked_at, created_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    )

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users ${whereClause}`,
      search ? [`%${search}%`] : [],
    )

    return res.json({
      users: usersResult.rows,
      pagination: {
        page: Math.max(page, 1),
        limit,
        total: countResult.rows[0]?.count || 0,
      },
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/users/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, is_blocked, blocked_reason, blocked_at, created_at,
              'inactive'::text AS subscription_status
       FROM users WHERE id = $1`,
      [req.params.id],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    return res.json({ user })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/users/:id/block', async (req, res) => {
  const shouldBlock = req.body?.isBlocked !== false
  const blockedReason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim()
    : null

  try {
    const result = await pool.query(
      `UPDATE users
       SET is_blocked = $1,
           blocked_reason = CASE WHEN $1 THEN $2 ELSE NULL END,
           blocked_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $3
       RETURNING id, email, is_blocked, blocked_reason, blocked_at`,
      [shouldBlock, blockedReason, req.params.id],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    console.log('[AUDIT_LOG_PLACEHOLDER]', {
      action: shouldBlock ? 'user_blocked' : 'user_unblocked',
      actorUserId: req.userId,
      targetUserId: user.id,
      reason: blockedReason,
      at: new Date().toISOString(),
    })

    return res.json({ user })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
