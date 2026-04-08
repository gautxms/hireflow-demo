import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const E164_REGEX = /^\+[1-9]\d{1,14}$/
const GRACE_PERIOD_DAYS = 30

function sanitizeText(value, maxLength = 100) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

router.use(requireAuth)

router.get('/me', async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      company: req.user.company || '',
      phone: req.user.phone || '',
      subscription_status: req.user.subscription_status || 'inactive',
      created_at: req.user.created_at,
      deleted_at: req.user.deleted_at,
      deletion_scheduled_for: req.user.deletion_scheduled_for,
    },
  })
})

router.patch('/me', async (req, res) => {
  const { company, phone, email } = req.body ?? {}
  console.info('[profile.patch] Profile update requested', { userId: req.user?.id, hasCompany: company !== undefined, hasPhone: phone !== undefined })

  if (email !== undefined) {
    return res.status(400).json({ error: 'Email cannot be changed from account settings' })
  }

  const updates = []
  const values = []

  if (company !== undefined) {
    values.push(sanitizeText(company, 100))
    updates.push(`company = $${values.length}`)
  }

  if (phone !== undefined) {
    const normalizedPhone = sanitizeText(phone, 20)

    if (normalizedPhone && !E164_REGEX.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Phone must use E.164 format (example: +14155552671).' })
    }

    values.push(normalizedPhone)
    updates.push(`phone = $${values.length}`)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' })
  }

  values.push(req.user.id)

  try {
    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, email, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for`,
      values,
    )

    return res.json({
      message: 'Profile updated successfully',
      user: result.rows[0],
    })
  } catch (error) {
    console.error('[profile.patch] Failed to update profile', { userId: req.user?.id, error: error.message })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/change-password', async (req, res) => {
  const oldPassword = sanitizeText(req.body?.oldPassword, 256)
  const newPassword = sanitizeText(req.body?.newPassword, 256)
  const confirmPassword = sanitizeText(req.body?.confirmPassword, 256)

  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'oldPassword, newPassword and confirmPassword are required' })
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' })
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation must match' })
  }

  try {
    const currentPassword = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
    const passwordHash = currentPassword.rows[0]?.password_hash

    if (!passwordHash) {
      return res.status(404).json({ error: 'User not found' })
    }

    const passwordCheck = await pool.query('SELECT crypt($1, $2) = $2 AS is_valid', [oldPassword, passwordHash])

    if (!passwordCheck.rows[0]?.is_valid) {
      return res.status(400).json({ error: 'Old password is incorrect' })
    }

    await pool.query('UPDATE users SET password_hash = crypt($1, gen_salt(\'bf\', 10)) WHERE id = $2', [newPassword, req.user.id])

    return res.json({ message: 'Password updated successfully' })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/export', async (req, res) => {
  try {
    const [userResult, resumeResult, subscriptionResult] = await Promise.all([
      pool.query(
        `SELECT id, email, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for
         FROM users
         WHERE id = $1`,
        [req.user.id],
      ),
      pool.query('SELECT id, filename, created_at FROM resumes WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
      pool.query(
        'SELECT id, paddle_subscription_id, status, created_at, updated_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
        [req.user.id],
      ),
    ])

    return res.json({
      exported_at: new Date().toISOString(),
      data: {
        user: userResult.rows[0] || null,
        resumes: resumeResult.rows,
        subscriptions: subscriptionResult.rows,
      },
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/me', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW(),
           deletion_scheduled_for = NOW() + INTERVAL '${GRACE_PERIOD_DAYS} days',
           subscription_status = 'inactive'
       WHERE id = $1
       RETURNING deleted_at, deletion_scheduled_for`,
      [req.user.id],
    )

    return res.json({
      message: `Account scheduled for deletion in ${GRACE_PERIOD_DAYS} days`,
      deleted_at: result.rows[0]?.deleted_at,
      deletion_scheduled_for: result.rows[0]?.deletion_scheduled_for,
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
