import { Router } from 'express'
import { pool } from '../db/client.js'
import { resetTokenAuth } from '../middleware/resetTokenAuth.js'
import {
  createPasswordResetToken,
  generateResetToken,
  getResetRateLimitState,
  normalizeEmail,
  recordResetAttempt,
  markTokenUsedAndResetPassword,
} from '../services/resetTokenService.js'
import { sendPasswordResetConfirmationEmail, sendPasswordResetEmail } from '../utils/mailer.js'

const router = Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getFrontendOrigin() {
  return process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173'
}

function buildResetUrl(token) {
  const url = new URL('/reset-password', getFrontendOrigin())
  url.searchParams.set('token', token)
  return url.toString()
}

router.post('/forgot-password', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email)

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' })
  }

  const rateLimitState = getResetRateLimitState(normalizedEmail)

  if (rateLimitState.blocked) {
    return res.status(429).json({
      error: 'Too many reset attempts. Please try again in an hour.',
      retryAfterSeconds: rateLimitState.retryAfterSeconds,
    })
  }

  recordResetAttempt(normalizedEmail)

  try {
    const result = await pool.query(
      `SELECT id, email
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [normalizedEmail],
    )

    const user = result.rows[0]

    if (user) {
      const token = generateResetToken()
      await createPasswordResetToken(user.id, token)

      await sendPasswordResetEmail({
        to: user.email,
        firstName: user.email.split('@')[0],
        resetUrl: buildResetUrl(token),
      })

      console.info('[AUTH] Password reset requested', {
        userId: user.id,
        email: normalizedEmail,
      })
    } else {
      console.info('[AUTH] Password reset requested for non-existent email', {
        email: normalizedEmail,
      })
    }

    return res.json({
      success: true,
      message: 'Check your email for reset link',
    })
  } catch (error) {
    console.error('[AUTH] Failed to create password reset request:', error)
    return res.status(500).json({ error: 'Unable to process password reset request.' })
  }
})

router.get('/reset-password', resetTokenAuth({ allowValidFalseResponse: true }), (req, res) => {
  return res.json({
    valid: true,
    email: req.resetTokenRecord.email,
  })
})

router.post('/reset-password', resetTokenAuth(), async (req, res) => {
  const { newPassword, confirmPassword } = req.body || {}

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' })
  }

  try {
    await markTokenUsedAndResetPassword({
      tokenId: req.resetTokenRecord.id,
      userId: req.resetTokenRecord.user_id,
      newPassword,
    })

    await sendPasswordResetConfirmationEmail({
      to: req.resetTokenRecord.email,
      firstName: req.resetTokenRecord.email.split('@')[0],
    })

    console.info('[AUTH] Password reset successful', {
      userId: req.resetTokenRecord.user_id,
      email: req.resetTokenRecord.email,
    })

    return res.json({
      success: true,
      message: 'Password reset successful',
    })
  } catch (error) {
    console.error('[AUTH] Failed to reset password:', error)
    return res.status(500).json({ error: 'Unable to reset password.' })
  }
})

export default router
