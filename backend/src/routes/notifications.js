import { Router } from 'express'
import {
  createTransactionalNotification,
  listUserNotifications,
} from '../services/notificationService.js'
import { pool } from '../db/client.js'

const router = Router()

const ALLOWED_TYPES = new Set(['demo.request.submitted'])

function sanitizeString(value, maxLength = 512) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

async function getUserEmail(userId) {
  const result = await pool.query(
    `SELECT email
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  )

  return result.rows[0]?.email || null
}

router.get('/', async (req, res) => {
  try {
    const page = req.query.page || 1
    const pageSize = req.query.pageSize || 20
    const data = await listUserNotifications({
      userId: req.userId,
      page,
      pageSize,
    })

    return res.json(data)
  } catch (error) {
    console.error('[Notifications] Failed to list notifications:', error)
    return res.status(500).json({ error: 'Unable to fetch notifications' })
  }
})

router.post('/transactional', async (req, res) => {
  const type = sanitizeString(req.body?.type, 80)
  const recipientEmail = sanitizeString(req.body?.recipientEmail, 255).toLowerCase()
  const payload = typeof req.body?.payload === 'object' && req.body.payload ? req.body.payload : {}
  const headerIdempotencyKey = sanitizeString(req.headers['x-idempotency-key'], 128)
  const bodyIdempotencyKey = sanitizeString(req.body?.idempotencyKey, 128)
  const idempotencyKey = headerIdempotencyKey || bodyIdempotencyKey

  if (!ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: 'Unsupported notification type' })
  }

  if (!recipientEmail || !recipientEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid recipientEmail is required' })
  }

  try {
    const userEmail = await getUserEmail(req.userId)
    if (!userEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (userEmail.toLowerCase() !== recipientEmail) {
      return res.status(403).json({ error: 'recipientEmail must match the authenticated user email' })
    }

    const result = await createTransactionalNotification({
      userId: req.userId,
      type,
      recipientEmail,
      payload,
      idempotencyKey,
    })

    if (result.duplicate) {
      return res.status(200).json({ ok: true, duplicate: true, idempotencyKey: result.idempotencyKey, delivery: result.delivery })
    }

    const code = result.delivery.status === 'sent' ? 201 : 502
    return res.status(code).json({ ok: result.delivery.status === 'sent', duplicate: false, idempotencyKey: result.idempotencyKey, delivery: result.delivery })
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to process transactional notification' })
  }
})

export default router
