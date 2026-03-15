import crypto from 'crypto'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { sendPasswordResetEmail } from '../utils/mailer.js'

const router = Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_TTL_MS = 60 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 3
const emailRateLimitStore = new Map()

function normalizeEmail(email) {
  if (typeof email !== 'string') {
    return ''
  }

  return email.trim().toLowerCase()
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildResetUrl(req, token) {
  const frontendOrigin = process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173'
  const url = new URL(`/reset-password/${token}`, frontendOrigin)
  return url.toString()
}

function getDashboardUrl() {
  return process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173'
}

function isRateLimited(normalizedEmail) {
  const now = Date.now()
  const record = emailRateLimitStore.get(normalizedEmail)

  if (!record || now - record.windowStartedAt >= TOKEN_TTL_MS) {
    emailRateLimitStore.set(normalizedEmail, { count: 1, windowStartedAt: now })
    return false
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true
  }

  record.count += 1
  return false
}

router.post('/request', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email)

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' })
  }

  if (isRateLimited(normalizedEmail)) {
    return res.status(429).json({ error: 'Too many reset attempts. Please try again in an hour.' })
  }

  try {
    const result = await pool.query('SELECT id, email FROM users WHERE email = $1', [normalizedEmail])
    const user = result.rows[0]

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

      await pool.query(
        `UPDATE users
         SET password_reset_token = $1,
             password_reset_expires_at = $2
         WHERE id = $3`,
        [tokenHash, expiresAt, user.id],
      )

      const resetUrl = buildResetUrl(req, rawToken)
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        dashboardUrl: getDashboardUrl(),
      })
    }

    return res.json({
      message: 'If that email exists in our system, a password reset link has been sent.',
    })
  } catch {
    return res.status(500).json({ error: 'Unable to process password reset request.' })
  }
})

router.get('/verify/:token', async (req, res) => {
  const { token } = req.params

  if (typeof token !== 'string' || token.length < 20) {
    return res.status(400).json({ error: 'Invalid token format.' })
  }

  try {
    const tokenHash = hashToken(token)
    const result = await pool.query(
      `SELECT id
       FROM users
       WHERE password_reset_token = $1
         AND password_reset_expires_at > NOW()`,
      [tokenHash],
    )

    if (!result.rows[0]) {
      return res.status(401).json({ error: 'Reset token is invalid or expired.' })
    }

    return res.json({ message: 'Reset token is valid.' })
  } catch {
    return res.status(500).json({ error: 'Unable to verify reset token.' })
  }
})

router.post('/confirm/:token', async (req, res) => {
  const { token } = req.params
  const { password, confirmPassword } = req.body || {}

  if (typeof token !== 'string' || token.length < 20) {
    return res.status(400).json({ error: 'Invalid token format.' })
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' })
  }

  try {
    const tokenHash = hashToken(token)
    const result = await pool.query(
      `UPDATE users
       SET password_hash = crypt($1, gen_salt('bf', 10)),
           password_reset_token = NULL,
           password_reset_expires_at = NULL
       WHERE password_reset_token = $2
         AND password_reset_expires_at > NOW()
       RETURNING id`,
      [password, tokenHash],
    )

    if (!result.rows[0]) {
      return res.status(401).json({ error: 'Reset token is invalid or expired.' })
    }

    return res.json({ message: 'Password has been reset successfully.' })
  } catch {
    return res.status(500).json({ error: 'Unable to reset password.' })
  }
})

export default router
