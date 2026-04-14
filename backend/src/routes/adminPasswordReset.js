import crypto from 'crypto'
import { Router } from 'express'
import { pool } from '../db/client.js'

const router = Router()

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return `$pbkdf2$${salt.toString('hex')}$${hash.toString('hex')}`
}

// POST /api/admin/reset-password-temporary
// Body: { email, newPassword, resetToken }
// This is a TEMPORARY endpoint for initial admin setup only
router.post('/', async (req, res) => {
  const { email, newPassword, resetToken } = req.body || {}

  // Verify reset token (one-time use)
  const validToken = process.env.ADMIN_PASSWORD_RESET_TOKEN
  if (!validToken || resetToken !== validToken) {
    return res.status(401).json({ error: 'Invalid reset token' })
  }

  if (!email || !newPassword) {
    return res.status(400).json({ error: 'Email and newPassword required' })
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const normalizedEmail = email.toLowerCase().trim()

    // Update password
    const result = await pool.query(
      'UPDATE users SET password_hash = $2 WHERE email = $1 AND is_admin = true RETURNING id, email',
      [normalizedEmail, hashPassword(newPassword)]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin user not found' })
    }

    console.log('[Admin Password Reset] Updated password for:', normalizedEmail)

    return res.json({
      success: true,
      message: 'Admin password reset successfully',
      email: result.rows[0].email,
      next: 'Try logging in with the new password',
    })
  } catch (error) {
    console.error('[Admin Password Reset] Error:', error.message)
    return res.status(500).json({ error: 'Reset failed' })
  }
})

export default router
