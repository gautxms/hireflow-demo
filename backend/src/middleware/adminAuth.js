import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { pool } from '../db/client.js'

const ADMIN_SESSION_TIMEOUT_MS = 15 * 60 * 1000
const ADMIN_COOKIE_NAME = 'admin_token'

function parseAllowedIpEntries() {
  const raw = process.env.ADMIN_IP_WHITELIST || ''
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function ipToNumber(ipv4) {
  return ipv4.split('.').reduce((acc, octet) => {
    const num = Number.parseInt(octet, 10)
    return (acc << 8) + num
  }, 0) >>> 0
}

function matchesRange(ip, range) {
  const [network, bitsString] = range.split('/')
  const bits = Number.parseInt(bitsString, 10)
  if (!network || Number.isNaN(bits)) return false

  const ipNum = ipToNumber(ip)
  const networkNum = ipToNumber(network)
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0)

  return (ipNum & mask) === (networkNum & mask)
}

function isIpAllowed(clientIp) {
  const allowedEntries = parseAllowedIpEntries()
  if (!allowedEntries.length) return true

  const normalizedIp = String(clientIp || '').replace('::ffff:', '')
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalizedIp)) {
    return false
  }

  return allowedEntries.some((entry) => {
    if (entry.includes('/')) {
      return matchesRange(normalizedIp, entry)
    }

    return entry === normalizedIp
  })
}

function getToken(req) {
  const bearerToken = req.headers.authorization?.split(' ')[1]
  return bearerToken || req.cookies?.[ADMIN_COOKIE_NAME]
}

function setAdminCookie(res, token) {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_TIMEOUT_MS,
  })
}

function signAdminSessionToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })
}

function normalizeIp(ipAddress) {
  return String(ipAddress || '').replace('::ffff:', '')
}

async function upsertSession({ sessionId, adminId, email, ipAddress, now = Date.now() }) {
  const expiresAt = new Date(now + ADMIN_SESSION_TIMEOUT_MS)

  await pool.query(
    `INSERT INTO admin_sessions (session_id, admin_id, email, ip_address, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($5 / 1000.0), $6)
     ON CONFLICT (session_id)
     DO UPDATE SET
       admin_id = EXCLUDED.admin_id,
       email = EXCLUDED.email,
       ip_address = EXCLUDED.ip_address,
       updated_at = EXCLUDED.updated_at,
       expires_at = EXCLUDED.expires_at`,
    [sessionId, adminId, email, ipAddress, now, expiresAt],
  )

  return expiresAt
}

async function cleanupExpiredSessions(now = Date.now()) {
  await pool.query(
    'DELETE FROM admin_sessions WHERE expires_at <= to_timestamp($1 / 1000.0)',
    [now],
  )
}

export async function createAdminSession({ adminId, email, ipAddress, sessionId = crypto.randomUUID(), now = Date.now() }) {
  const normalizedIp = normalizeIp(ipAddress)

  const token = signAdminSessionToken({
    userId: adminId,
    isAdmin: true,
    twoFactorVerified: true,
    adminEmail: email,
    loginIp: normalizedIp,
    lastActivityAt: now,
    iatMs: now,
    sid: sessionId,
  })

  const expiresAtDate = await upsertSession({
    sessionId,
    adminId,
    email,
    ipAddress: normalizedIp,
    now,
  })

  return {
    token,
    sessionId,
    expiresInSeconds: Math.floor(ADMIN_SESSION_TIMEOUT_MS / 1000),
    expiresAt: expiresAtDate.toISOString(),
  }
}

export function parseAdminToken(req) {
  const token = getToken(req)

  if (!token) {
    return { error: 'missing' }
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    return { token, decoded }
  } catch {
    return { error: 'invalid' }
  }
}

export async function requireAdminAuth(req, res, next) {
  try {
    await cleanupExpiredSessions()

    const parsed = parseAdminToken(req)

    if (parsed.error === 'missing') {
      return res.status(401).json({ error: 'Admin authentication required' })
    }

    if (parsed.error === 'invalid') {
      return res.status(401).json({ error: 'Invalid admin token' })
    }

    const decoded = parsed.decoded
    if (!decoded?.isAdmin || !decoded?.twoFactorVerified) {
      return res.status(403).json({ error: 'Admin access requires verified 2FA' })
    }

    if (!decoded?.sid) {
      res.clearCookie(ADMIN_COOKIE_NAME)
      return res.status(401).json({ error: 'Admin session is no longer active' })
    }

    const activityTimestamp = Number(decoded.lastActivityAt || 0)
    if (!activityTimestamp || Date.now() - activityTimestamp > ADMIN_SESSION_TIMEOUT_MS) {
      await revokeAdminSession(decoded.sid)
      res.clearCookie(ADMIN_COOKIE_NAME)
      return res.status(401).json({ error: 'Admin session expired due to inactivity' })
    }

    const { rows } = await pool.query(
      `SELECT session_id
       FROM admin_sessions
       WHERE session_id = $1
         AND expires_at > NOW()`,
      [decoded.sid],
    )

    if (!rows[0]) {
      res.clearCookie(ADMIN_COOKIE_NAME)
      return res.status(401).json({ error: 'Admin session is no longer active' })
    }

    if (!isIpAllowed(req.ip)) {
      return res.status(403).json({ error: 'IP address is not on the admin allow list' })
    }

    req.admin = {
      id: decoded.userId,
      email: decoded.adminEmail,
      ipAddress: normalizeIp(req.ip),
      loginIp: decoded.loginIp,
      sessionId: decoded.sid,
    }

    const refreshed = await createAdminSession({
      adminId: decoded.userId,
      email: decoded.adminEmail,
      ipAddress: decoded.loginIp,
      sessionId: decoded.sid,
    })
    setAdminCookie(res, refreshed.token)
    res.setHeader('X-Admin-Session-Expires-At', refreshed.expiresAt)

    return next()
  } catch (error) {
    console.error('[AdminAuth] requireAdminAuth failed:', error)
    return res.status(500).json({ error: 'Unable to validate admin session' })
  }
}

export async function logAdminAction({
  adminId,
  actionType,
  targetId = null,
  details = {},
  ipAddress = null,
}) {
  await pool.query(
    `INSERT INTO admin_actions (admin_id, action_type, target_id, details, ip_address)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [adminId, actionType, targetId, JSON.stringify(details || {}), ipAddress],
  )
}

export function adminActionAuditMiddleware(req, res, next) {
  const startedAt = Date.now()

  res.on('finish', () => {
    if (!req.admin?.id) {
      return
    }

    const actionType = `${req.method} ${req.baseUrl}${req.route?.path || req.path}`
    const targetId = req.params?.id || req.params?.userId || req.params?.subscriptionId || null

    void logAdminAction({
      adminId: req.admin.id,
      actionType,
      targetId,
      details: {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        query: req.query,
      },
      ipAddress: req.admin.ipAddress,
    }).catch((error) => {
      console.error('[AdminAudit] failed to log admin action:', error)
    })
  })

  next()
}

export async function listAdminSessions(adminId, currentSessionId = null) {
  await cleanupExpiredSessions()

  const result = await pool.query(
    `SELECT session_id, ip_address, created_at, updated_at, expires_at
     FROM admin_sessions
     WHERE admin_id = $1
     ORDER BY updated_at DESC`,
    [adminId],
  )

  return result.rows.map((session) => ({
    id: session.session_id,
    ipAddress: session.ip_address,
    device: 'Browser session',
    location: 'Unknown',
    isCurrent: currentSessionId === session.session_id,
    createdAt: new Date(session.created_at).toISOString(),
    lastActivityAt: new Date(session.updated_at).toISOString(),
    expiresAt: new Date(session.expires_at).toISOString(),
  }))
}

export async function revokeAdminSession(sessionId) {
  await pool.query('DELETE FROM admin_sessions WHERE session_id = $1', [sessionId])
}

export async function revokeOtherAdminSessions(adminId, currentSessionId = null) {
  const params = [adminId]
  let whereClause = 'admin_id = $1'

  if (currentSessionId) {
    whereClause += ' AND session_id <> $2'
    params.push(currentSessionId)
  }

  const result = await pool.query(
    `DELETE FROM admin_sessions
     WHERE ${whereClause}`,
    params,
  )

  return result.rowCount || 0
}

export function clearAdminSession(res) {
  res.clearCookie(ADMIN_COOKIE_NAME)
}

export { ADMIN_SESSION_TIMEOUT_MS, ADMIN_COOKIE_NAME, isIpAllowed, setAdminCookie }
