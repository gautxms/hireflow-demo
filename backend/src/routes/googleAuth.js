import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../db/client.js'
import { googleIdentity } from '../services/googleIdentity.js'
import { hashPassword, verifyPassword } from '../services/passwordHash.js'
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js'
import { signToken } from '../utils/jwt.js'
import { trackEvent } from '../services/analytics.js'
import { triggerWebhook } from '../services/webhookService.js'

const router = Router()
const CSRF_COOKIE = 'hf_google_auth_csrf'
const TERMS_VERSION = '2026-11-19'
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function enabled(req, res, next) {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') return res.status(404).json({ error: 'Not found' })
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Google sign-in is unavailable' })
  }
  return next()
}

function originAllowed(req) {
  const allowed = new Set([
    'http://localhost:5173',
    'https://hireflow.dev',
    ...String(process.env.FRONTEND_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean),
    String(process.env.APP_ORIGIN || '').trim(),
  ])
  return allowed.has(req.get('origin'))
}

function csrfValid(req) {
  const header = req.get('x-hireflow-google-csrf')
  const cookie = req.cookies?.[CSRF_COOKIE]
  if (!originAllowed(req) || !/^[a-f0-9]{64}$/.test(header || '') || !/^[a-f0-9]{64}$/.test(cookie || '')) return false
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(cookie))
}

function protect(req, res, next) {
  if (!csrfValid(req)) return res.status(403).json({ error: 'Invalid sign-in request' })
  return next()
}

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' }
}

function pendingToken(identity) {
  return jwt.sign(
    { purpose: 'google_auth_pending', subject: identity.subject, email: identity.email },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  )
}

function readPending(value) {
  try {
    const decoded = jwt.verify(value, process.env.JWT_SECRET)
    if (decoded.purpose !== 'google_auth_pending' || !decoded.subject || !EMAIL_REGEX.test(decoded.email)) return null
    return { subject: decoded.subject, email: decoded.email }
  } catch {
    return null
  }
}

function session(res, user) {
  const token = signToken(user)
  res.cookie('token', token, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 })
  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      email_verified: user.email_verified,
      company: user.company || '',
      phone: user.phone || '',
      subscription_status: user.subscription_status || 'inactive',
      created_at: user.created_at,
      deleted_at: user.deleted_at,
      deletion_scheduled_for: user.deletion_scheduled_for,
    },
  })
}

async function recordEvent(user, kind) {
  try {
    await trackEvent({ userId: user.id, eventType: kind, metadata: { source: 'auth.google' } })
  } catch (error) {
    console.error('[Google Auth] Analytics event failed', { name: error?.name })
  }
  if (kind === 'signup') {
    try {
      await triggerWebhook('user.created', {
        userId: user.id, email: user.email, company: user.company || '', createdAt: user.created_at,
      })
    } catch (error) {
      console.error('[Google Auth] Signup webhook failed', { name: error?.name })
    }
  }
}

router.get('/csrf', enabled, (_req, res) => {
  const value = crypto.randomBytes(32).toString('hex')
  res.cookie(CSRF_COOKIE, value, { ...cookieOptions(), maxAge: 10 * 60 * 1000 })
  res.set('Cache-Control', 'no-store')
  return res.json({ csrfToken: value })
})

router.post('/', enabled, loginLimiter, protect, async (req, res) => {
  if (typeof req.body?.credential !== 'string' || req.body.credential.length > 10000) {
    return res.status(400).json({ error: 'Google credential is required' })
  }
  let identity
  try {
    identity = await googleIdentity.verify(req.body.credential)
  } catch {
    return res.status(401).json({ error: 'Google sign-in failed' })
  }
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.email_verified, u.company, u.phone, u.subscription_status,
              u.created_at, u.deleted_at, u.deletion_scheduled_for, u.is_admin
       FROM user_auth_identities i JOIN users u ON u.id = i.user_id
       WHERE i.provider = 'google' AND i.provider_subject = $1`,
      [identity.subject],
    )
    const user = result.rows[0]
    if (user) {
      if (user.deleted_at || user.is_admin) return res.status(403).json({ error: 'This account cannot use Google sign-in' })
      await pool.query(
        `UPDATE user_auth_identities SET last_login_at = NOW(), provider_email = $2
         WHERE provider = 'google' AND provider_subject = $1`,
        [identity.subject, identity.email],
      )
      await recordEvent(user, 'login')
      return session(res, user)
    }

    const existing = await pool.query('SELECT id, deleted_at, is_admin FROM users WHERE email = $1', [identity.email])
    const account = existing.rows[0]
    if (account?.deleted_at || account?.is_admin) return res.status(403).json({ error: 'This account cannot use Google sign-in' })
    res.set('Cache-Control', 'no-store')
    return res.json({
      status: account ? 'link_required' : 'signup_required',
      email: identity.email,
      continuationToken: pendingToken(identity),
    })
  } catch {
    return res.status(500).json({ error: 'Google sign-in is unavailable' })
  }
})

router.post('/signup', enabled, signupLimiter, protect, async (req, res) => {
  const identity = readPending(req.body?.continuationToken)
  if (!identity) return res.status(401).json({ error: 'Restart Google sign-in' })
  if (req.body?.acceptTerms !== true) return res.status(400).json({ error: 'Accept the Terms and Privacy Policy to continue' })
  const company = typeof req.body.company === 'string' ? req.body.company.trim() : ''
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : ''
  if (company.length > 100 || !/^[a-zA-Z0-9\-\s]*$/.test(company) || (phone && !/^\+[1-9]\d{1,14}$/.test(phone))) {
    return res.status(400).json({ error: 'Invalid company or phone' })
  }
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const result = await client.query(
      `INSERT INTO users (email, password_hash, password_login_enabled, email_verified,
                          company, phone, terms_accepted_at, terms_version)
       VALUES ($1, $2, false, true, $3, $4, NOW(), $5)
       RETURNING id, email, email_verified, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for`,
      [identity.email, hashPassword(crypto.randomBytes(32).toString('hex')), company, phone, TERMS_VERSION],
    )
    const user = result.rows[0]
    await client.query(
      `INSERT INTO user_auth_identities (user_id, provider, provider_subject, provider_email)
       VALUES ($1, 'google', $2, $3)`,
      [user.id, identity.subject, identity.email],
    )
    await client.query('COMMIT')
    client.release()
    client = null
    await recordEvent(user, 'signup')
    return session(res, user)
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    return res.status(error.code === '23505' ? 409 : 500).json({
      error: error.code === '23505' ? 'Account already exists. Restart Google sign-in.' : 'Unable to create account',
    })
  } finally {
    client?.release()
  }
})

router.post('/link', enabled, loginLimiter, protect, async (req, res) => {
  const identity = readPending(req.body?.continuationToken)
  if (!identity) return res.status(401).json({ error: 'Restart Google sign-in' })
  if (typeof req.body.password !== 'string' || !req.body.password) {
    return res.status(400).json({ error: 'Current password is required' })
  }
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, email, email_verified, company, phone, password_hash, password_login_enabled,
              subscription_status, created_at, deleted_at, deletion_scheduled_for, is_admin
       FROM users WHERE email = $1 FOR UPDATE`,
      [identity.email],
    )
    const user = result.rows[0]
    if (!user || !user.password_login_enabled || !verifyPassword(req.body.password, user.password_hash)) {
      await client.query('ROLLBACK')
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (user.deleted_at || user.is_admin) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'This account cannot use Google sign-in' })
    }
    await client.query(
      `INSERT INTO user_auth_identities (user_id, provider, provider_subject, provider_email)
       VALUES ($1, 'google', $2, $3)`,
      [user.id, identity.subject, identity.email],
    )
    await client.query('COMMIT')
    client.release()
    client = null
    await recordEvent(user, 'login')
    return session(res, user)
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    return res.status(error.code === '23505' ? 409 : 500).json({
      error: error.code === '23505' ? 'Google account already linked. Restart sign-in.' : 'Unable to link account',
    })
  } finally {
    client?.release()
  }
})

export default router
