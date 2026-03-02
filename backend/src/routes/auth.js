import crypto from 'crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { pool } from '../db/client.js'
import { signToken } from '../utils/jwt.js'
import { sendVerificationEmail } from '../utils/mailer.js'

const router = Router()

const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
})

function validateInput(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string') {
    return false
  }

  const normalizedEmail = email.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  return emailRegex.test(normalizedEmail) && password.length >= 8
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

router.post('/signup', authRateLimit, async (req, res) => {
  const { email, password } = req.body

  if (!validateInput(email, password)) {
    return res.status(400).json({ error: 'Invalid email or password (min 8 chars)' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const verificationToken = crypto.randomBytes(32).toString('hex')
  const verificationTokenHash = hashVerificationToken(verificationToken)
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, email_verification_token, email_verification_expires_at)
       VALUES ($1, crypt($2, gen_salt('bf', 10)), $3, $4)
       RETURNING id, email, created_at`,
      [normalizedEmail, password, verificationTokenHash, verificationExpiresAt],
    )

    const user = result.rows[0]
    const token = signToken(user.id)
    setAuthCookie(res, token)

    const verificationUrl = buildVerificationUrl(req, verificationToken)
    await sendVerificationEmail({
      to: user.email,
      verificationUrl,
    })

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
    })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' })
    }

    return res.status(500).json({ error: 'Internal server error' })
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

    return res.redirect(getVerificationSuccessUrl())
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/login', authRateLimit, async (req, res) => {
  const { email, password } = req.body

  if (!validateInput(email, password)) {
    return res.status(400).json({ error: 'Invalid email or password' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
      [normalizedEmail],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const passwordCheck = await pool.query(
      'SELECT crypt($1, $2) = $2 AS is_valid',
      [password, user.password_hash],
    )

    if (!passwordCheck.rows[0]?.is_valid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = signToken(user.id)
    setAuthCookie(res, token)

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/logout', (_req, res) => {
  res.clearCookie('token')
  return res.status(204).send()
})

export default router
