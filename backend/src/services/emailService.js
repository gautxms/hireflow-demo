import fs from 'fs/promises'
import path from 'path'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'
import https from 'https'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const templateDirectory = path.resolve(__dirname, '../templates/emails')

let transporter
let missingConfigWarningShown = false

function getAppUrl() {
  const frontendOrigin = process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim()
  return frontendOrigin || process.env.APP_ORIGIN || 'http://localhost:5173'
}

function getBrandingValues() {
  const appUrl = getAppUrl()
  const unsubscribePath = process.env.EMAIL_UNSUBSCRIBE_PATH || '/api/email-campaigns/unsubscribe'

  return {
    companyName: process.env.COMPANY_NAME || 'HireFlow',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@hireflow.dev',
    logoUrl: process.env.COMPANY_LOGO_URL || `${appUrl}/vite.svg`,
    appUrl,
    year: String(new Date().getUTCFullYear()),
    unsubscribeBaseUrl: `${appUrl}${unsubscribePath}`,
  }
}

function getSendGridConfig() {
  const apiKey = process.env.SENDGRID_API_KEY
  const from = process.env.SMTP_FROM || 'noreply@hireflow.dev'
  
  if (!apiKey) {
    return null
  }
  
  return { apiKey, from }
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM

  if (!host || !port || !user || !pass || !from) {
    // Log which variables are missing for debugging
    const missing = []
    if (!host) missing.push('SMTP_HOST')
    if (!port || isNaN(port)) missing.push('SMTP_PORT')
    if (!user) missing.push('SMTP_USER')
    if (!pass) missing.push('SMTP_PASS')
    if (!from) missing.push('SMTP_FROM')
    
    if (process.env.NODE_ENV === 'production') {
      console.error('[EMAIL] Missing SMTP config. Required variables:', missing.join(', '))
    }
    
    return null
  }

  return { host, port, user, pass, from }
}

function getTransporter() {
  const smtpConfig = getSmtpConfig()

  if (!smtpConfig) {
    if (!missingConfigWarningShown) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[EMAIL] ⚠️  SMTP config missing. Transactional and campaign emails are disabled.')
        console.warn('[EMAIL] Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in Railway environment.')
      } else {
        console.warn('[EMAIL] SMTP config missing. Emails will be logged to console in dev mode.')
      }
      missingConfigWarningShown = true
    }

    // Return a dev transporter that logs to console
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
      return {
        transporter: {
          sendMail: async (mailOptions) => {
            console.log('[EMAIL] Dev mode - would send email:', {
              to: mailOptions.to,
              subject: mailOptions.subject,
              from: mailOptions.from,
            })
            return true
          }
        },
        smtpConfig: { from: 'noreply@hireflow.dev' }
      }
    }

    return null
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    })
  }

  return { transporter, smtpConfig }
}

async function renderTemplate(templateName, variables = {}) {
  const templatePath = path.join(templateDirectory, `${templateName}.html`)
  const templateContent = await fs.readFile(templatePath, 'utf8')

  return templateContent.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = variables[key]
    return value == null ? '' : String(value)
  })
}

function getFirstName(email, firstName) {
  if (firstName && typeof firstName === 'string') {
    return firstName
  }

  return email.split('@')[0]
}

function withDefaults({ to, firstName, unsubscribeUrl, ...values }) {
  const branding = getBrandingValues()

  return {
    ...branding,
    to,
    firstName: getFirstName(to, firstName),
    unsubscribeUrl: unsubscribeUrl || `${branding.unsubscribeBaseUrl}?email=${encodeURIComponent(to)}`,
    ...values,
  }
}

async function sendViaSendGridAPI({ to, subject, text, html, from }) {
  const sendGridConfig = getSendGridConfig()
  
  if (!sendGridConfig) {
    return false
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
          subject,
        },
      ],
      from: { email: from },
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    })

    const options = {
      hostname: 'api.sendgrid.com',
      port: 443,
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${sendGridConfig.apiKey}`,
      },
    }

    const req = https.request(options, (res) => {
      if (res.statusCode === 202) {
        console.log(`[EMAIL] ✓ Sent via SendGrid API: ${subject} → ${to}`)
        resolve(true)
      } else {
        console.warn(`[EMAIL] SendGrid API error (${res.statusCode}): ${subject} → ${to}`)
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          console.warn('[EMAIL] Response:', data)
          resolve(false)
        })
      }
    })

    req.on('error', (error) => {
      console.warn(`[EMAIL] SendGrid API connection error: ${error.message}`)
      resolve(false)
    })

    req.write(payload)
    req.end()
  })
}

async function sendTemplateEmail({ to, subject, templateName, text, values }) {
  const renderedHtml = await renderTemplate(templateName, values)
  const from = values.companyName ? `noreply@hireflow.dev` : 'noreply@hireflow.dev'

  // Try SendGrid API first (works on Railway without SMTP issues)
  const sendGridConfig = getSendGridConfig()
  if (sendGridConfig) {
    const sent = await sendViaSendGridAPI({
      to,
      subject,
      text,
      html: renderedHtml,
      from: sendGridConfig.from,
    })
    if (sent) return true
  }

  // Fallback to SMTP
  const mailer = getTransporter()
  if (!mailer) {
    return false
  }

  try {
    await mailer.transporter.sendMail({
      from: mailer.smtpConfig.from,
      to,
      subject,
      text,
      html: renderedHtml,
    })

    return true
  } catch (error) {
    console.warn(`[EMAIL] Failed to send ${templateName} email:`, error.message)
    return false
  }
}

export function logEmailConfigStatus() {
  const sendGridConfig = getSendGridConfig()
  const smtpConfig = getSmtpConfig()
  
  console.log('[EMAIL] Configuration status:')
  
  if (sendGridConfig) {
    console.log('  ✓ SendGrid API:', sendGridConfig.from)
  } else {
    console.log('  ✗ SendGrid API key missing (SENDGRID_API_KEY)')
  }
  
  if (smtpConfig) {
    console.log('  ✓ SMTP:', `${smtpConfig.user}@${smtpConfig.host}:${smtpConfig.port}`)
  } else {
    console.log('  ✗ SMTP not configured')
  }
  
  if (!sendGridConfig && !smtpConfig) {
    console.log('[EMAIL] ⚠️  No email service configured. Verification emails will not be sent.')
    console.log('[EMAIL] Please set either SENDGRID_API_KEY or SMTP_* variables.')
  }
}

export async function previewEmailTemplate(templateName, values = {}) {
  const mergedValues = withDefaults({ to: values.to || 'demo@hireflow.dev', ...values })
  const html = await renderTemplate(templateName, mergedValues)
  return { html, values: mergedValues }
}

export async function sendVerificationEmail({ to, verificationUrl }) {
  const values = withDefaults({
    to,
    verificationUrl,
  })

  return sendTemplateEmail({
    to,
    subject: 'Verify your HireFlow email',
    templateName: 'verification',
    text: `Welcome to HireFlow. Verify your email by visiting: ${verificationUrl}`,
    values,
  })
}

export async function sendWelcomeEmail({ to }) {
  const values = withDefaults({
    to,
    dashboardUrl: `${getAppUrl()}/dashboard?utm_source=email&utm_campaign=welcome`,
  })

  return sendTemplateEmail({
    to,
    subject: 'Welcome to HireFlow',
    templateName: 'welcome',
    text: `Welcome to HireFlow, ${values.firstName}. Your account is verified. Visit your dashboard: ${values.dashboardUrl}`,
    values,
  })
}

export async function sendInvoiceEmail({ to, invoiceId, amount, invoiceDate, planName }) {
  const values = withDefaults({
    to,
    invoiceId,
    amount,
    invoiceDate,
    planName,
    billingUrl: `${getAppUrl()}/billing?utm_source=email&utm_campaign=invoice`,
  })

  return sendTemplateEmail({
    to,
    subject: `Your HireFlow invoice ${invoiceId}`,
    templateName: 'invoice',
    text: `Payment received for ${planName}. Invoice ${invoiceId}, amount ${amount} on ${invoiceDate}. Manage billing: ${values.billingUrl}`,
    values,
  })
}

export async function sendCancellationEmail({ to, endsOn }) {
  const values = withDefaults({
    to,
    endsOn,
    pricingUrl: `${getAppUrl()}/pricing?utm_source=email&utm_campaign=cancellation`,
  })

  return sendTemplateEmail({
    to,
    subject: 'Your HireFlow subscription was cancelled',
    templateName: 'cancellation',
    text: `Your subscription has been cancelled and remains active until ${endsOn}. You can reactivate here: ${values.pricingUrl}`,
    values,
  })
}

export async function sendReengagementEmail({ to }) {
  const values = withDefaults({
    to,
    dashboardUrl: `${getAppUrl()}/dashboard?utm_source=email&utm_campaign=reengagement`,
  })

  return sendTemplateEmail({
    to,
    subject: 'Come back to HireFlow',
    templateName: 'reengagement',
    text: `We've added new candidate insights. Return to your dashboard: ${values.dashboardUrl}`,
    values,
  })
}

export async function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  const values = withDefaults({
    to,
    firstName,
    resetUrl,
  })

  return sendTemplateEmail({
    to,
    subject: 'Reset Your HireFlow Password',
    templateName: 'password-reset',
    text: `Hi ${values.firstName}, reset your password using this link: ${resetUrl}. This link expires in 1 hour.`,
    values,
  })
}

export async function sendPasswordResetConfirmationEmail({ to, firstName }) {
  const values = withDefaults({
    to,
    firstName,
  })

  return sendTemplateEmail({
    to,
    subject: 'Your HireFlow password was changed',
    templateName: 'welcome',
    text: `Hi ${values.firstName}, your password was reset successfully. If this wasn't you, contact support immediately.`,
    values: {
      ...values,
      dashboardUrl: `${getAppUrl()}/settings/security`,
    },
  })
}


export async function sendDemoRequestConfirmationEmail({ to, requesterName }) {
  const values = withDefaults({
    to,
    firstName: requesterName || undefined,
    dashboardUrl: `${getAppUrl()}/about`,
  })

  return sendTemplateEmail({
    to,
    subject: 'We received your demo request',
    templateName: 'welcome',
    text: `Hi ${values.firstName}, thanks for requesting a demo. Our team will reach out shortly.`,
    values,
  })
}
export async function sendDemoRequestEmail({
  requesterName,
  requesterEmail,
  company,
  phone,
  message,
  to = 'hello@gfactai.com',
}) {
  const values = withDefaults({
    to,
    requesterName,
    requesterEmail,
    company,
    phone: phone || 'Not provided',
    message,
  })

  return sendTemplateEmail({
    to,
    subject: `New demo request from ${requesterName}`,
    templateName: 'demo-request',
    text: [
      'New demo request submitted.',
      `Name: ${requesterName}`,
      `Email: ${requesterEmail}`,
      `Company: ${company}`,
      `Phone: ${phone || 'Not provided'}`,
      `Message: ${message}`,
    ].join('\n'),
    values,
  })
}
