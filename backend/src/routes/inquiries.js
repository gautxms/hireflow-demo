import { Router } from 'express'
import { pool } from '../db/client.js'
import { createTransactionalNotification } from '../services/notificationService.js'

const router = Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitizeText(value, maxLength = 2000) {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .normalize('NFKC')
    .replace(/[<>`]/g, '')
    .trim()
    .slice(0, maxLength)
}

function getIdempotencyKey(req, normalizedPayload) {
  const headerKey = sanitizeText(req.headers['x-idempotency-key'], 128)
  if (headerKey) return headerKey

  return [
    'demo-request',
    normalizedPayload.email,
    normalizedPayload.company,
    normalizedPayload.message.slice(0, 120),
    normalizedPayload.selectedDate,
    normalizedPayload.selectedTime,
  ].join(':')
}

async function persistInquiry({
  inquiryType,
  name,
  email,
  company = null,
  phone = null,
  subject = null,
  message,
  metadata = {},
}) {
  const result = await pool.query(
    `INSERT INTO inquiries (inquiry_type, name, email, company, phone, subject, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, inquiry_type, status, name, email, company, phone, subject, message, metadata, created_at, updated_at, reviewed_at`,
    [
      inquiryType,
      name,
      email,
      company || null,
      phone || null,
      subject || null,
      message,
      JSON.stringify(metadata || {}),
    ],
  )

  return result.rows[0]
}

router.post('/contact', async (req, res) => {
  const name = sanitizeText(req.body?.name, 120)
  const email = sanitizeText(req.body?.email, 255).toLowerCase()
  const company = sanitizeText(req.body?.company, 180)
  const subject = sanitizeText(req.body?.subject, 120)
  const message = sanitizeText(req.body?.message, 2000)

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' })
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Valid email is required.' })
  }

  if (!subject) {
    return res.status(400).json({ error: 'Subject is required.' })
  }

  if (!message || message.length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters.' })
  }

  try {
    const inquiry = await persistInquiry({
      inquiryType: 'contact',
      name,
      email,
      company,
      subject,
      message,
    })

    return res.status(201).json({ success: true, inquiryId: inquiry.id })
  } catch (error) {
    console.error('[INQUIRIES] Failed to submit contact inquiry:', error)
    return res.status(500).json({ error: 'Unable to submit contact inquiry.' })
  }
})

router.post('/demo-request', async (req, res) => {
  const name = sanitizeText(req.body?.name, 120)
  const email = sanitizeText(req.body?.email, 255).toLowerCase()
  const company = sanitizeText(req.body?.company, 180)
  const phone = sanitizeText(req.body?.phone, 80)
  const message = sanitizeText(req.body?.message, 2000)
  const selectedDate = sanitizeText(req.body?.selectedDate, 64)
  const selectedTime = sanitizeText(req.body?.selectedTime, 64)
  const companySize = sanitizeText(req.body?.companySize, 32)

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

  const idempotencyKey = getIdempotencyKey(req, { email, company, message, selectedDate, selectedTime })

  try {
    const inquiry = await persistInquiry({
      inquiryType: 'demo',
      name,
      email,
      company,
      phone,
      message,
      metadata: {
        selectedDate: selectedDate || null,
        selectedTime: selectedTime || null,
        companySize: companySize || null,
      },
    })

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
      inquiryId: inquiry.id,
      duplicate: adminDelivery.duplicate && confirmation.duplicate,
    })
  } catch (error) {
    console.error('[INQUIRIES] Failed to send demo request email:', error)
    return res.status(500).json({ error: 'Unable to submit demo request.' })
  }
})

export default router
