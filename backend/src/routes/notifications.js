import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { requireAdminAuth } from '../middleware/adminAuth.js'
import { sendEmail } from '../services/emailService.js'

const router = Router()

async function getUserEmail(userId) {
  const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId])
  return result.rows[0]?.email || null
}

router.post('/feature-update', requireAuth, async (req, res) => {
  try {
    const email = await getUserEmail(req.userId)

    if (!email) {
      return res.status(404).json({ error: 'User email not found' })
    }

    const sent = await sendEmail({
      to: email,
      template: 'new-feature',
    })

    return res.json({ sent })
  } catch (error) {
    console.error('[Notifications] Failed to send feature update email', error)
    return res.status(500).json({ error: 'Unable to send feature update notification' })
  }
})

router.post('/subscription-renewal', requireAuth, async (req, res) => {
  try {
    const email = await getUserEmail(req.userId)

    if (!email) {
      return res.status(404).json({ error: 'User email not found' })
    }

    const sent = await sendEmail({
      to: email,
      template: 'subscription-renewal',
    })

    return res.json({ sent })
  } catch (error) {
    console.error('[Notifications] Failed to send subscription renewal email', error)
    return res.status(500).json({ error: 'Unable to send subscription renewal notification' })
  }
})

router.post('/admin-alert', requireAdminAuth, async (req, res) => {
  const to = typeof req.body?.to === 'string' ? req.body.to.trim().toLowerCase() : req.admin?.email
  const context = typeof req.body?.context === 'string' ? req.body.context.trim() : ''

  if (!to) {
    return res.status(400).json({ error: 'Recipient email is required' })
  }

  try {
    const sent = await sendEmail({
      to,
      template: 'admin-alert',
      data: { context },
    })

    return res.json({ sent })
  } catch (error) {
    console.error('[Notifications] Failed to send admin alert email', error)
    return res.status(500).json({ error: 'Unable to send admin alert notification' })
  }
})

export default router
