import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { pool } from '../db/client.js'
import { signToken } from '../utils/jwt.js'

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

router.post('/signup', authRateLimit, async (req, res) => {
  const { email, password } = req.body

  if (!validateInput(email, password)) {
    return res.status(400).json({ error: 'Invalid email or password (min 8 chars)' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, crypt($2, gen_salt('bf', 10)))
       RETURNING id, email, created_at`,
      [normalizedEmail, password],
    )

    const user = result.rows[0]
    const token = signToken(user.id)
    setAuthCookie(res, token)

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
