import { Router } from 'express'
import { createTransactionalNotification } from '../services/notificationService.js'

const router = Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitizeText(value, maxLength = 2000) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().slice(0, maxLength)
}

function getIdempotencyKey(req, normalizedPayload) {
  const headerKey = sanitizeText(req.headers['x-idempotency-key'], 128)
  if (headerKey) return headerKey

  return [
    'demo-request',
    normalizedPayload.email,
    normalizedPayload.company,
    normalizedPayload.message.slice(0, 120),
  ].join(':')
}

router.post('/demo-request', async (req, res) => {
  const name = sanitizeText(req.body?.name, 120)
  const email = sanitizeText(req.body?.email, 255).toLowerCase()
  const company = sanitizeText(req.body?.company, 180)
  const phone = sanitizeText(req.body?.phone, 80)
  const message = sanitizeText(req.body?.message, 2000)

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' })
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Valid email is required.' })
  }

  if (!company) {
    return res.status(400).json({ error: 'Company is required.' })
  }

  if (!message) {
    return res.status(400).json({ error: 'Message is required.' })
  }

  const idempotencyKey = getIdempotencyKey(req, { email, company, message })

  try {
    const adminDelivery = await createTransactionalNotification({
      userId: null,
      type: 'demo.request.received',
      recipientEmail: 'hello@gfactai.com',
      payload: {
        requesterName: name,
        requesterEmail: email,
        company,
        phone,
        message,
      },
      idempotencyKey: `${idempotencyKey}:admin`,
    })

    const confirmation = await createTransactionalNotification({
      userId: null,
      type: 'demo.request.submitted',
      recipientEmail: email,
      payload: {
        requesterName: name,
        requesterEmail: email,
        company,
        phone,
        message: 'Thanks for requesting a demo. Our team will reach out shortly.',
      },
      idempotencyKey: `${idempotencyKey}:requester`,
    })

    if (adminDelivery.delivery.status === 'failed') {
      return res.status(503).json({ error: 'Unable to send request email right now.' })
    }

    return res.status(201).json({
      success: true,
      duplicate: adminDelivery.duplicate && confirmation.duplicate,
    })
  } catch (error) {
    console.error('[INQUIRIES] Failed to send demo request email:', error)
    return res.status(500).json({ error: 'Unable to submit demo request.' })
  }
})

export default router
