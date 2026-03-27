import crypto from 'crypto'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { signToken } from '../utils/jwt.js'
import { sendVerificationEmail } from '../utils/mailer.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js'
import { trackEvent } from '../services/analytics.js'

const router = Router()
const resendVerificationAttemptsByEmail = new Map()

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return `$pbkdf2$${salt.toString('hex')}$${hash.toString('hex')}`
}

function verifyPassword(password, hash) {
  const [_, __, saltHex, hashHex] = hash.split('$')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  return computed === hashHex
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildVerificationUrl(req, token) {
  const configuredApiUrl = process.env.BACKEND_PUBLIC_URL
  const baseUrl = configuredApiUrl || `${req.protocol}://${req.get('host')}`
  const url = new URL('/api/auth/verify-email', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function getVerificationSuccessUrl() {
  const configuredSuccessUrl = process.env.EMAIL_VERIFICATION_SUCCESS_URL

  if (configuredSuccessUrl) {
    return configuredSuccessUrl
  }

  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  return `${frontendOrigin}/verify-email/success`
}

function getResendWindowState(email, now = Date.now()) {
  const oneMinuteAgo = now - 60 * 1000
  const oneHourAgo = now - 60 * 60 * 1000
  const attemptHistory = resendVerificationAttemptsByEmail.get(email) || []
  const recentAttempts = attemptHistory.filter((timestamp) => timestamp > oneHourAgo)

  resendVerificationAttemptsByEmail.set(email, recentAttempts)

  const mostRecentAttempt = recentAttempts[recentAttempts.length - 1]
  const retryAfterOneMinute = mostRecentAttempt ? Math.ceil((mostRecentAttempt + 60 * 1000 - now) / 1000) : 0

  if (mostRecentAttempt && mostRecentAttempt > oneMinuteAgo && retryAfterOneMinute > 0) {
    return {
      blocked: true,
      retryAfterSeconds: retryAfterOneMinute,
      reason: 'minute',
    }
  }

  if (recentAttempts.length >= 5) {
    const oldestAttemptInWindow = recentAttempts[0]
    const retryAfterOneHour = Math.ceil((oldestAttemptInWindow + 60 * 60 * 1000 - now) / 1000)

    if (retryAfterOneHour > 0) {
      return {
        blocked: true,
        retryAfterSeconds: retryAfterOneHour,
        reason: 'hour',
      }
    }
  }

  return {
    blocked: false,
    retryAfterSeconds: 0,
  }
}

function recordResendAttempt(email, now = Date.now()) {
  const attempts = resendVerificationAttemptsByEmail.get(email) || []
  resendVerificationAttemptsByEmail.set(email, [...attempts, now])
}

router.post('/signup', signupLimiter, validateBody(schemas.signup), async (req, res) => {
  console.log('[AUTH] Signup route called')
  const { email, password, company = '', phone = '' } = req.body

  const normalizedEmail = email.trim().toLowerCase()
  const verificationToken = crypto.randomBytes(32).toString('hex')
  const verificationTokenHash = hashVerificationToken(verificationToken)
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  try {
    console.log('[AUTH] Signup attempt for:', normalizedEmail)
    console.log('[AUTH] About to hash password and insert user into database')
    const passwordHash = hashPassword(password)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, company, phone, email_verification_token, email_verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, company, phone, created_at`,
      [normalizedEmail, passwordHash, company, phone, verificationTokenHash, verificationExpiresAt],
    )
    console.log('[AUTH] Insert query completed')

    const user = result.rows[0]
    console.log('[AUTH] User created with id:', user?.id)
    const token = signToken({ ...user, subscription_status: 'trialing' })
    setAuthCookie(res, token)

    const verificationUrl = buildVerificationUrl(req, verificationToken)

    try {
      await sendVerificationEmail({
        to: user.email,
        verificationUrl,
      })
    } catch (mailError) {
      console.error('[AUTH] Failed to send verification email:', mailError)
    }

    try {
      console.log('[AUTH] About to track event for user:', user.id)
      await trackEvent({
        userId: user.id,
        eventType: 'signup',
        metadata: { source: 'auth.signup' },
      })
      console.log('[AUTH] Event tracked successfully')
    } catch (trackError) {
      console.error('[AUTH] Failed to track event:', trackError)
    }

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        company: user.company || '',
        phone: user.phone || '',
        subscription_status: 'trialing',
        created_at: user.created_at,
      },
    })
  } catch (error) {
    console.error('[AUTH] Signup error:', error.message, error.code)
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' })
    }

    return res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

router.get('/verify-email', async (req, res) => {
  const token = req.query.token

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).json({ error: 'Invalid token' })
  }

  const verificationTokenHash = hashVerificationToken(token)

  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL
       WHERE email_verification_token = $1
         AND email_verification_expires_at > NOW()
       RETURNING id`,
      [verificationTokenHash],
    )

    if (!result.rows[0]) {
      return res.status(400).json({ error: 'Invalid or expired token' })
    }

    await trackEvent({
      userId: result.rows[0].id,
      eventType: 'email_verified',
      metadata: { source: 'auth.verify_email' },
    })

    return res.redirect(getVerificationSuccessUrl())
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/resend-email-verification', signupLimiter, async (req, res) => {
  const normalizedEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Valid email is required' })
  }

  const resendWindow = getResendWindowState(normalizedEmail)

  if (resendWindow.blocked) {
    console.info('[AUTH] Verification email resend blocked', {
      email: normalizedEmail,
      retryAfterSeconds: resendWindow.retryAfterSeconds,
      reason: resendWindow.reason,
    })

    return res.status(429).json({
      error: 'Too many resend attempts',
      retryAfterSeconds: resendWindow.retryAfterSeconds,
    })
  }

  recordResendAttempt(normalizedEmail)

  try {
    const result = await pool.query(
      `SELECT id, email, email_verified, email_verification_expires_at
       FROM users
       WHERE email = $1`,
      [normalizedEmail],
    )

    const user = result.rows[0]

    if (!user || user.email_verified) {
      console.info('[AUTH] Verification email resend attempted for non-pending account', {
        email: normalizedEmail,
      })

      return res.json({
        message: 'Email sent! Check your inbox',
        retryAfterSeconds: 60,
      })
    }

    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationTokenHash = hashVerificationToken(verificationToken)
    const existingTokenStillValid =
      user.email_verification_expires_at && new Date(user.email_verification_expires_at).getTime() > Date.now()
    const verificationExpiresAt = existingTokenStillValid
      ? new Date(user.email_verification_expires_at)
      : new Date(Date.now() + 24 * 60 * 60 * 1000)

    await pool.query(
      `UPDATE users
       SET email_verification_token = $1,
           email_verification_expires_at = $2
       WHERE id = $3`,
      [verificationTokenHash, verificationExpiresAt, user.id],
    )

    const verificationUrl = buildVerificationUrl(req, verificationToken)

    await sendVerificationEmail({
      to: user.email,
      verificationUrl,
    })

    console.info('[AUTH] Verification email resent', {
      userId: user.id,
      email: user.email,
    })

    return res.json({
      message: 'Email sent! Check your inbox',
      retryAfterSeconds: 60,
    })
  } catch (error) {
    console.error('[AUTH] Failed to resend verification email:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/login', loginLimiter, validateBody(schemas.login), async (req, res) => {
  const { email, password } = req.body

  const normalizedEmail = email.trim().toLowerCase()

  try {
    console.log('[AUTH] Login attempt for:', normalizedEmail)
    const result = await pool.query(
      'SELECT id, email, company, phone, password_hash, created_at, subscription_status, deleted_at, deletion_scheduled_for FROM users WHERE email = $1',
      [normalizedEmail],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    console.log('[AUTH] User found, password_hash format:', user.password_hash?.substring(0, 20))
    const isValidPassword = verifyPassword(password, user.password_hash)
    console.log('[AUTH] Password valid:', isValidPassword)

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (user.deleted_at) {
      return res.status(403).json({ error: 'Account is scheduled for deletion. Contact support to recover access.' })
    }

    const token = signToken(user)
    setAuthCookie(res, token)

    await trackEvent({
      userId: user.id,
      eventType: 'login',
      metadata: { source: 'auth.login' },
    })

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        company: user.company || '',
        phone: user.phone || '',
        subscription_status: user.subscription_status,
        created_at: user.created_at,
        deleted_at: user.deleted_at,
        deletion_scheduled_for: user.deletion_scheduled_for,
      },
    })
  } catch (error) {
    console.error('[AUTH] Login error:', error.message)
    return res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

router.post('/logout', (_req, res) => {
  res.clearCookie('token')
  return res.status(204).send()
})

export default router
