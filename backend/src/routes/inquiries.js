import { Router } from 'express'
import { sendDemoRequestEmail } from '../utils/mailer.js'

const router = Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitizeText(value, maxLength = 2000) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().slice(0, maxLength)
}

router.post('/demo-request', async (req, res) => {
  const name = sanitizeText(req.body?.name, 120)
  const email = sanitizeText(req.body?.email, 255)
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

  try {
    const sent = await sendDemoRequestEmail({
      requesterName: name,
      requesterEmail: email,
      company,
      phone,
      message,
      to: 'hello@gfactai.com',
    })

    if (!sent) {
      return res.status(503).json({ error: 'Unable to send request email right now.' })
    }

    return res.status(201).json({ success: true })
  } catch (error) {
    console.error('[INQUIRIES] Failed to send demo request email:', error)
    return res.status(500).json({ error: 'Unable to submit demo request.' })
  }
})

export default router
