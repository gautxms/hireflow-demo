import crypto from 'crypto'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { createAdminSession, setAdminCookie } from '../middleware/adminAuth.js'

const router = Router()
const magicLinks = new Map() // In-memory store, expires in 10 minutes

// POST /api/admin/magic-link/request
// Body: { email }
// Returns: { success: true, message: "Check your email" }
router.post('/request', async (req, res) => {
  const { email } = req.body || {}

  if (!email) {
    return res.status(400).json({ error: 'Email required' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  try {
    // Check if admin exists
    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND is_admin = true LIMIT 1',
      [normalizedEmail]
    )

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Admin account not found' })
    }

    const userId = result.rows[0].id
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

    magicLinks.set(token, { userId, email: normalizedEmail, expiresAt })

    const magicUrl = `https://hireflow.dev/admin/magic-login?token=${token}`

    console.log('[Admin Magic Link] Generated for:', normalizedEmail)
    console.log('[Admin Magic Link] URL:', magicUrl)

    return res.json({
      success: true,
      message: 'Magic link generated. Use the token below to login.',
      token,
      magicUrl,
    })
  } catch (error) {
    console.error('[Admin Magic Link] Error:', error.message)
    return res.status(500).json({ error: 'Request failed' })
  }
})

// POST /api/admin/magic-link/verify
// Body: { token }
// Returns: { success: true, redirectUrl: '/admin/analytics' }
router.post('/verify', async (req, res) => {
  const { token } = req.body || {}

  if (!token) {
    return res.status(400).json({ error: 'Token required' })
  }

  const linkData = magicLinks.get(token)

  if (!linkData) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  if (Date.now() > linkData.expiresAt) {
    magicLinks.delete(token)
    return res.status(401).json({ error: 'Token expired' })
  }

  try {
    const { userId, email } = linkData

    // Create admin session
    const session = await createAdminSession({
      adminId: userId,
      email,
      ipAddress: String(req.ip || '').replace('::ffff:', ''),
    })

    setAdminCookie(res, session.token)

    // Clean up token
    magicLinks.delete(token)

    console.log('[Admin Magic Link] Login successful for:', email)

    return res.json({
      success: true,
      message: 'Login successful',
      redirectUrl: '/admin/analytics',
    })
  } catch (error) {
    console.error('[Admin Magic Link] Verify error:', error.message)
    return res.status(500).json({ error: 'Verification failed' })
  }
})

export default router
