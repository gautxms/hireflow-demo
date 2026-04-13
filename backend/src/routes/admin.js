import jwt from 'jsonwebtoken'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { getRateLimitStats } from '../middleware/rateLimiter.js'
import { createPasswordResetToken, generateResetToken } from '../services/resetTokenService.js'
import { sendPasswordResetEmail } from '../utils/mailer.js'
import { createAdminSession, listAdminSessions, revokeOtherAdminSessions, setAdminCookie } from '../middleware/adminAuth.js'

const router = Router()

function getMonthStart(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null
}

function getFrontendOrigin() {
  return process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173'
}

function buildResetUrl(token) {
  const url = new URL('/reset-password', getFrontendOrigin())
  url.searchParams.set('token', token)
  return url.toString()
}

async function ensureAdminUserColumns() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  `)
}

router.get('/users', async (req, res) => {
  const search = String(req.query.search || '').trim()

  try {
    await ensureAdminUserColumns()

    const params = [search ? `%${search}%` : '']
    const result = await pool.query(
      `SELECT u.id,
              u.email,
              u.company,
              u.phone,
              u.subscription_status,
              u.paddle_subscription_id,
              u.created_at,
              u.deleted_at,
              COALESCE(u.is_blocked, u.blocked, false) AS is_blocked
       FROM users u
       WHERE ($1 = '' OR u.email ILIKE $1 OR COALESCE(u.company, '') ILIKE $1)
       ORDER BY u.created_at DESC`,
      params,
    )

    return res.json({
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        company: row.company,
        phone: row.phone,
        subscription_status: row.subscription_status,
        created_at: toIso(row.created_at),
        deleted_at: toIso(row.deleted_at),
        is_blocked: Boolean(row.is_blocked),
        status: row.deleted_at ? 'inactive' : (row.is_blocked ? 'blocked' : 'active'),
      })),
    })
  } catch (error) {
    console.error('[Admin users] list failed:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/users/:id', async (req, res) => {
  const { id } = req.params

  try {
    await ensureAdminUserColumns()

    const userResult = await pool.query(
      `SELECT u.id,
              u.email,
              u.company,
              u.phone,
              u.subscription_status,
              u.created_at,
              u.deleted_at,
              COALESCE(u.is_blocked, u.blocked, false) AS is_blocked
       FROM users u
       WHERE u.id::text = $1
       LIMIT 1`,
      [id],
    )

    const user = userResult.rows[0]
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const auditResult = await pool.query(
      `SELECT id, admin_id, action_type, details, created_at
       FROM admin_actions
       WHERE target_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id],
    )

    return res.json({
      user: {
        ...user,
        created_at: toIso(user.created_at),
        deleted_at: toIso(user.deleted_at),
        is_blocked: Boolean(user.is_blocked),
      },
      auditTrail: auditResult.rows.map((row) => ({
        id: row.id,
        action: row.action_type,
        actor: row.admin_id,
        details: row.details || {},
        created_at: toIso(row.created_at),
      })),
    })
  } catch (error) {
    console.error('[Admin users] detail failed:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params
  const { action, reason, company, phone, email, is_blocked: isBlockedInput, resetPassword } = req.body || {}

  try {
    await ensureAdminUserColumns()

    const userResult = await pool.query(
      'SELECT id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked FROM users WHERE id::text = $1 LIMIT 1',
      [id],
    )
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const shouldBlock = action === 'block' || isBlockedInput === true
    const shouldUnblock = action === 'unblock' || isBlockedInput === false
    const shouldReset = action === 'reset_password' || resetPassword === true
    const shouldEdit = action === 'edit' || company !== undefined || phone !== undefined || email !== undefined

    let nextUser = { ...user }
    let auditAction = 'user_updated'
    let auditDetails = {}

    if (shouldBlock || shouldUnblock) {
      const nextBlocked = shouldBlock ? true : false
      const updateResult = await pool.query(
        `UPDATE users
         SET blocked = $2,
             is_blocked = $2
         WHERE id::text = $1
         RETURNING id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked`,
        [id, nextBlocked],
      )
      nextUser = updateResult.rows[0]
      auditAction = nextBlocked ? 'user_blocked' : 'user_unblocked'
      auditDetails = { reason: reason || null }
    }

    if (shouldEdit) {
      const updateResult = await pool.query(
        `UPDATE users
         SET email = COALESCE($2, email),
             company = COALESCE($3, company),
             phone = COALESCE($4, phone)
         WHERE id::text = $1
         RETURNING id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked`,
        [id, email || null, company || null, phone || null],
      )
      nextUser = updateResult.rows[0]
      auditAction = 'user_profile_updated'
      auditDetails = { email: email || undefined, company: company || undefined, phone: phone || undefined }
    }

    if (shouldReset) {
      const token = generateResetToken()
      await createPasswordResetToken(user.id, token)
      await sendPasswordResetEmail({
        to: user.email,
        firstName: user.email.split('@')[0],
        resetUrl: buildResetUrl(token),
      })
      auditAction = 'user_password_reset_sent'
      auditDetails = { via: 'admin' }
    }

    return res.json({
      ok: true,
      user: {
        id: nextUser.id,
        email: nextUser.email,
        company: nextUser.company,
        phone: nextUser.phone,
        is_blocked: Boolean(nextUser.is_blocked),
      },
      audit: {
        action: auditAction,
        actor: req.admin?.id || 'admin',
        details: auditDetails,
        created_at: new Date().toISOString(),
      },
      message: shouldReset ? 'Password reset email sent' : 'User updated',
    })
  } catch (error) {
    console.error('[Admin users] update failed:', error)
    return res.status(500).json({ error: 'Unable to update user' })
  }
})

router.post('/users/:id/impersonate', async (req, res) => {
  const { id } = req.params
  const expiresInMinutes = Math.max(1, Math.min(60, Number(req.body?.expiresInMinutes || 15)))

  try {
    const userResult = await pool.query(
      'SELECT id, email, company, phone, subscription_status, created_at, deleted_at FROM users WHERE id::text = $1 LIMIT 1',
      [id],
    )

    const user = userResult.rows[0]
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const impersonationToken = jwt.sign(
      {
        userId: user.id,
        user,
        impersonatedByAdminId: req.admin?.id || null,
        impersonation: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: `${expiresInMinutes}m` },
    )

    return res.json({
      ok: true,
      impersonationToken,
      expiresInMinutes,
      user: {
        id: user.id,
        email: user.email,
      },
      audit: {
        action: 'impersonation_token_created',
        actor: req.admin?.id || 'admin',
        details: { expiresInMinutes },
      },
    })
  } catch (error) {
    console.error('[Admin users] impersonation failed:', error)
    return res.status(500).json({ error: 'Failed to impersonate user' })
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

async function listAdminActions(req, res) {
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

    const actions = result.rows.map((row) => ({
      id: row.id,
      adminId: row.admin_id,
      actionType: row.action_type,
      targetId: row.target_id,
      details: row.details || {},
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }))

    return res.json({
      actions,
      items: actions,
    })
  } catch (error) {
    console.error('[Admin] Failed to query admin actions:', error)
    return res.status(500).json({ error: 'Unable to query admin actions' })
  }
}


router.get('/sessions', async (req, res) => {
  const sessions = await listAdminSessions(req.admin.id, req.admin.sessionId)
  return res.json({ sessions })
})

router.post('/sessions/refresh', async (req, res) => {
  const refreshed = await createAdminSession({
    adminId: req.admin.id,
    email: req.admin.email,
    ipAddress: req.admin.loginIp || req.admin.ipAddress,
    sessionId: req.admin.sessionId,
  })

  setAdminCookie(res, refreshed.token)
  res.setHeader('X-Admin-Session-Expires-At', refreshed.expiresAt)

  return res.status(200).json({
    ok: true,
    sessionTimeoutSeconds: refreshed.expiresInSeconds,
    sessionExpiresAt: refreshed.expiresAt,
  })
})

router.post('/sessions/logout-others', async (req, res) => {
  const revokedCount = await revokeOtherAdminSessions(req.admin.id, req.admin.sessionId)

  try {
    await pool.query(
      `INSERT INTO admin_actions (admin_id, action_type, details, ip_address)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [req.admin.id, 'admin_logout_other_sessions', JSON.stringify({ revokedCount }), req.admin.ipAddress],
    )
  } catch (error) {
    console.error('[Admin sessions] failed to log logout-other-sessions:', error)
  }

  return res.status(200).json({ ok: true, revokedCount })
})

router.get('/actions', listAdminActions)
router.get('/audit-trail', listAdminActions)

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
