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

export function createAdminSession({ adminId, email, ipAddress }) {
  const now = Date.now()
  const token = signAdminSessionToken({
    userId: adminId,
    isAdmin: true,
    twoFactorVerified: true,
    adminEmail: email,
    loginIp: ipAddress,
    lastActivityAt: now,
    iatMs: now,
  })

  return {
    token,
    expiresInSeconds: Math.floor(ADMIN_SESSION_TIMEOUT_MS / 1000),
    expiresAt: new Date(now + ADMIN_SESSION_TIMEOUT_MS).toISOString(),
  }
}

export function requireAdminAuth(req, res, next) {
  const token = getToken(req)

  if (!token) {
    return res.status(401).json({ error: 'Admin authentication required' })
  }

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid admin token' })
  }

  if (!decoded?.isAdmin || !decoded?.twoFactorVerified) {
    return res.status(403).json({ error: 'Admin access requires verified 2FA' })
  }

  const activityTimestamp = Number(decoded.lastActivityAt || 0)
  if (!activityTimestamp || Date.now() - activityTimestamp > ADMIN_SESSION_TIMEOUT_MS) {
    res.clearCookie(ADMIN_COOKIE_NAME)
    return res.status(401).json({ error: 'Admin session expired due to inactivity' })
  }

  if (!isIpAllowed(req.ip)) {
    return res.status(403).json({ error: 'IP address is not on the admin allow list' })
  }

  req.admin = {
    id: decoded.userId,
    email: decoded.adminEmail,
    ipAddress: String(req.ip || '').replace('::ffff:', ''),
    loginIp: decoded.loginIp,
  }

  const refreshed = createAdminSession({
    adminId: decoded.userId,
    email: decoded.adminEmail,
    ipAddress: decoded.loginIp,
  })
  setAdminCookie(res, refreshed.token)
  res.setHeader('X-Admin-Session-Expires-At', refreshed.expiresAt)

  return next()
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

export function clearAdminSession(res) {
  res.clearCookie(ADMIN_COOKIE_NAME)
}

export { ADMIN_SESSION_TIMEOUT_MS, ADMIN_COOKIE_NAME, isIpAllowed, setAdminCookie }
