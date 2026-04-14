import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db/client.js'
import { isIpAllowed } from '../middleware/adminAuth.js'

const router = Router()

const VALID_SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN?.trim()
const isSetupTokenConfigured = Boolean(VALID_SETUP_TOKEN)

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return `$pbkdf2$${salt.toString('hex')}$${hash.toString('hex')}`
}

async function adminExists() {
  const result = await pool.query('SELECT 1 FROM users WHERE is_admin = true LIMIT 1')
  return result.rows.length > 0
}

router.post('/', async (req, res) => {
  const { email, password, setupToken } = req.body || {}

  if (!isSetupTokenConfigured) {
    return res.status(503).json({
      error: 'Admin setup is disabled until ADMIN_SETUP_TOKEN is configured',
    })
  }

  if (!isIpAllowed(req.ip)) {
    return res.status(403).json({ error: 'IP address is not on the admin allow list' })
  }

  if (setupToken !== VALID_SETUP_TOKEN) {
    return res.status(401).json({ error: 'Invalid setup token' })
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  if (password.length < 12) {
    return res.status(400).json({
      error: 'Password must be at least 12 characters',
    })
  }

  try {
    if (await adminExists()) {
      return res.status(403).json({
        error: 'Admin already exists. Setup is disabled.',
      })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail])

    let userId
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id
      await pool.query(
        'UPDATE users SET is_admin = true, password_hash = $2 WHERE id = $1',
        [userId, hashPassword(password)],
      )
      console.log('[Admin Setup] Promoted user to admin:', normalizedEmail)
    } else {
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, is_admin, email_verified, created_at)
         VALUES ($1, $2, true, true, NOW())
         RETURNING id`,
        [normalizedEmail, hashPassword(password)],
      )
      userId = result.rows[0].id
      console.log('[Admin Setup] Created new admin user:', normalizedEmail)
    }

    return res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      adminId: userId,
      email: normalizedEmail,
      next: 'Login at /admin/login and set up 2FA',
    })
  } catch (error) {
    console.error('[Admin Setup] Error:', error.message)
    return res.status(500).json({
      error: 'Setup failed. Check server logs.',
    })
  }
})

export default router
