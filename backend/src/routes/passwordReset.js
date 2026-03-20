import { Router } from 'express'
import { pool } from '../db/client.js'
import { sendPasswordResetEmail } from '../utils/mailer.js'
import { emailSchema, validateBody, validateRequest, resetPasswordSchema } from '../middleware/validation.js'

const router = Router()

const TOKEN_TTL_MS = 60 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 3
const emailRateLimitStore = new Map()

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

const validateResetPasswordPayload = (req, _res, next) => {
  req.body = {
    token: req.params.token,
    newPassword: req.body?.password,
    confirmPassword: req.body?.confirmPassword,
  }
  return next()
}

router.post('/request', validateBody(emailSchema), async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email)

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

router.post('/confirm/:token', validateResetPasswordPayload, validateRequest(resetPasswordSchema), async (req, res) => {
  const { token, newPassword } = req.body

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
      [newPassword, tokenHash],
    )

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
