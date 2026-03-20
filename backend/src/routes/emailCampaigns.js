import { Router } from 'express'
import { pool } from '../db/client.js'
import {
  previewEmailTemplate,
  sendReengagementEmail,
  sendWelcomeEmail,
  sendInvoiceEmail,
  sendCancellationEmail,
  sendPasswordResetEmail,
} from '../services/emailService.js'

const router = Router()

const supportedTemplates = new Set(['welcome', 'invoice', 'cancellation', 'reengagement', 'password-reset', 'verification'])

router.get('/preview/:templateName', async (req, res) => {
  const { templateName } = req.params

  if (!supportedTemplates.has(templateName)) {
    return res.status(404).json({ error: 'Unknown template' })
  }

  try {
    const { html } = await previewEmailTemplate(templateName, {
      to: req.query.email || 'preview@hireflow.dev',
      invoiceId: 'INV-2026-001',
      amount: '$99.00',
      invoiceDate: new Date().toISOString().slice(0, 10),
      planName: 'HireFlow Pro Monthly',
      endsOn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      dashboardUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/dashboard`,
      billingUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/billing`,
      pricingUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/pricing`,
      resetUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/reset-password?token=demo-token`,
      verificationUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/verify-email?token=demo-token`,
    })

    res.set('Content-Type', 'text/html')
    return res.status(200).send(html)
  } catch (error) {
    console.error('[EMAIL_CAMPAIGNS] Failed to preview template', error)
    return res.status(500).json({ error: 'Failed to render preview' })
  }
})

router.post('/reengagement/send', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT email
       FROM users
       WHERE created_at < NOW() - INTERVAL '30 days'
         AND COALESCE(subscription_status, 'inactive') <> 'active'
       LIMIT 500`,
    )

    let sentCount = 0

    for (const row of result.rows) {
      const sent = await sendReengagementEmail({ to: row.email })
      if (sent) {
        sentCount += 1
      }
    }

    return res.json({
      eligibleUsers: result.rowCount,
      sentCount,
    })
  } catch (error) {
    console.error('[EMAIL_CAMPAIGNS] Failed to send reengagement campaign', error)
    return res.status(500).json({ error: 'Unable to send reengagement campaign' })
  }
})

router.post('/send-test', async (req, res) => {
  const { templateName, to } = req.body || {}

  if (!supportedTemplates.has(templateName) || !to) {
    return res.status(400).json({ error: 'templateName and to are required' })
  }

  const commonPayload = { to }

  try {
    let sent = false

    if (templateName === 'welcome') sent = await sendWelcomeEmail(commonPayload)
    if (templateName === 'invoice') {
      sent = await sendInvoiceEmail({ ...commonPayload, invoiceId: 'INV-TEST-001', amount: '$99.00', invoiceDate: new Date().toISOString().slice(0, 10), planName: 'HireFlow Pro Monthly' })
    }
    if (templateName === 'cancellation') {
      sent = await sendCancellationEmail({ ...commonPayload, endsOn: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) })
    }
    if (templateName === 'reengagement') sent = await sendReengagementEmail(commonPayload)
    if (templateName === 'password-reset') {
      sent = await sendPasswordResetEmail({ ...commonPayload, resetUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/reset-password?token=test-token` })
    }

    return res.json({ sent })
  } catch (error) {
    console.error('[EMAIL_CAMPAIGNS] Failed to send test email', error)
    return res.status(500).json({ error: 'Unable to send test email' })
  }
})

router.get('/unsubscribe', (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email : 'this address'
  return res.status(200).send(`<html><body style="font-family: Arial, sans-serif;"><h2>Unsubscribed</h2><p>${email} has been unsubscribed from promotional campaign emails.</p></body></html>`)
})

export default router
