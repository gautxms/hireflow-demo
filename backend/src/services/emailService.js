import fs from 'fs/promises'
import path from 'path'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'
import https from 'https'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const templateDirectory = path.resolve(__dirname, '../templates/emails')

let transporter
let sesClient
let missingConfigWarningShown = false

const VALID_EMAIL_PROVIDERS = new Set(['ses', 'sendgrid', 'smtp', 'console'])

function getAppUrl() {
  const frontendOrigin = process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim()
  return frontendOrigin || process.env.APP_ORIGIN || 'http://localhost:5173'
}

function getRecipientDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return 'unknown'
  }
  return email.split('@')[1].toLowerCase()
}

function logEmailEvent(level, event, details = {}) {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  logger(`[EMAIL] ${event}`, details)
}

function getConfiguredProvider() {
  const rawProvider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase()
  if (VALID_EMAIL_PROVIDERS.has(rawProvider)) {
    return rawProvider
  }
  return 'ses'
}

function getBrandingValues() {
  const appUrl = getAppUrl()
  const unsubscribePath = process.env.EMAIL_UNSUBSCRIBE_PATH || '/api/email-campaigns/unsubscribe'

  return {
    companyName: process.env.COMPANY_NAME || 'HireFlow',
    supportEmail: process.env.SUPPORT_EMAIL || 'gautam@hireflow.dev',
    logoUrl: process.env.COMPANY_LOGO_URL || `${appUrl}/vite.svg`,
    appUrl,
    year: String(new Date().getUTCFullYear()),
    unsubscribeBaseUrl: `${appUrl}${unsubscribePath}`,
  }
}

function getReplyToAddresses() {
  const replyTo = process.env.REPLY_TO_EMAIL?.trim()
  return replyTo ? [replyTo] : undefined
}

function getFromAddress() {
  return process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || 'HireFlow <gautam@hireflow.dev>'
}

function getSendGridConfig() {
  const apiKey = process.env.SENDGRID_API_KEY
  const from = getFromAddress()

  if (!apiKey) return null
  return { apiKey, from }
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM

  if (!host || !port || !user || !pass || !from) {
    return null
  }

  return { host, port, user, pass, from }
}

function getSesConfig() {
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
  const from = getFromAddress()

  if (!region || !from) {
    return null
  }

  if (!accessKeyId || !secretAccessKey) {
    return null
  }

  return {
    region,
    from,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  }
}

function getTransporter() {
  const smtpConfig = getSmtpConfig()
  if (!smtpConfig) return null

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

function getSesClient(config) {
  if (!sesClient) {
    sesClient = new SESClient({
      region: config.region,
      credentials: config.credentials,
    })
  }
  return sesClient
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

export function getDemoRequestRecipient() {
  return process.env.DEMO_REQUEST_TO_EMAIL || process.env.SUPPORT_EMAIL || 'gautam@hireflow.dev'
}

async function sendViaSes({ to, subject, text, html }) {
  const sesConfig = getSesConfig()
  if (!sesConfig) {
    logEmailEvent('warn', 'SES config missing', { provider: 'ses', status: 'config_missing' })
    return false
  }

  try {
    const client = getSesClient(sesConfig)
    const command = new SendEmailCommand({
      Source: sesConfig.from,
      Destination: {
        ToAddresses: [to],
      },
      ReplyToAddresses: getReplyToAddresses(),
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: text },
          Html: { Data: html },
        },
      },
    })
    const response = await client.send(command)
    logEmailEvent('info', 'Email sent', {
      provider: 'ses',
      recipientDomain: getRecipientDomain(to),
      messageId: response?.MessageId,
      status: 'success',
    })
    return true
  } catch (error) {
    logEmailEvent('warn', 'Email send failed', {
      provider: 'ses',
      recipientDomain: getRecipientDomain(to),
      status: 'failed',
      code: error?.name || 'SES_SEND_FAILED',
    })
    return false
  }
}

async function sendViaSendGridAPI({ to, subject, text, html }) {
  const sendGridConfig = getSendGridConfig()
  if (!sendGridConfig) {
    logEmailEvent('warn', 'SendGrid config missing', { provider: 'sendgrid', status: 'config_missing' })
    return false
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: { email: sendGridConfig.from },
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
      reply_to_list: getReplyToAddresses()?.map((email) => ({ email })),
    })

    const options = {
      hostname: 'api.sendgrid.com',
      port: 443,
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${sendGridConfig.apiKey}`,
      },
    }

    const req = https.request(options, (res) => {
      if (res.statusCode === 202) {
        logEmailEvent('info', 'Email sent', { provider: 'sendgrid', recipientDomain: getRecipientDomain(to), status: 'success' })
        resolve(true)
      } else {
        logEmailEvent('warn', 'Email send failed', {
          provider: 'sendgrid',
          recipientDomain: getRecipientDomain(to),
          status: 'failed',
          code: `HTTP_${res.statusCode}`,
        })
        resolve(false)
      }
    })

    req.on('error', (error) => {
      logEmailEvent('warn', 'Email send failed', {
        provider: 'sendgrid',
        recipientDomain: getRecipientDomain(to),
        status: 'failed',
        code: error?.code || 'SENDGRID_REQUEST_FAILED',
      })
      resolve(false)
    })

    req.write(payload)
    req.end()
  })
}

async function sendViaSmtp({ to, subject, text, html }) {
  const mailer = getTransporter()
  if (!mailer) {
    logEmailEvent('warn', 'SMTP config missing', { provider: 'smtp', status: 'config_missing' })
    return false
  }

  try {
    await mailer.transporter.sendMail({
      from: mailer.smtpConfig.from,
      to,
      subject,
      text,
      html,
      replyTo: process.env.REPLY_TO_EMAIL,
    })
    logEmailEvent('info', 'Email sent', { provider: 'smtp', recipientDomain: getRecipientDomain(to), status: 'success' })
    return true
  } catch (error) {
    logEmailEvent('warn', 'Email send failed', {
      provider: 'smtp',
      recipientDomain: getRecipientDomain(to),
      status: 'failed',
      code: error?.code || error?.name || 'SMTP_SEND_FAILED',
    })
    return false
  }
}

async function sendViaConsole({ to, subject, templateName }) {
  if (process.env.NODE_ENV === 'production') {
    logEmailEvent('warn', 'Console provider blocked in production', {
      provider: 'console',
      recipientDomain: getRecipientDomain(to),
      templateName,
      status: 'blocked',
    })
    return false
  }

  logEmailEvent('info', 'Console email preview', {
    provider: 'console',
    recipientDomain: getRecipientDomain(to),
    templateName,
    subject,
    status: 'logged_only',
  })
  return true
}

export async function sendTemplateEmail({ to, subject, templateName, text, values }) {
  const renderedHtml = await renderTemplate(templateName, values)
  const provider = getConfiguredProvider()

  logEmailEvent('info', 'Preparing email', {
    provider,
    templateName,
    recipientDomain: getRecipientDomain(to),
  })

  try {
    if (provider === 'ses') return await sendViaSes({ to, subject, text, html: renderedHtml })
    if (provider === 'sendgrid') return await sendViaSendGridAPI({ to, subject, text, html: renderedHtml })
    if (provider === 'smtp') return await sendViaSmtp({ to, subject, text, html: renderedHtml })
    if (provider === 'console') return await sendViaConsole({ to, subject, templateName })

    if (!missingConfigWarningShown) {
      logEmailEvent('warn', 'Unknown email provider', { provider, status: 'invalid_provider' })
      missingConfigWarningShown = true
    }
    return false
  } catch (error) {
    logEmailEvent('error', 'Unhandled email send failure', {
      provider,
      templateName,
      recipientDomain: getRecipientDomain(to),
      status: 'failed',
      code: error?.name || 'UNKNOWN_ERROR',
    })
    return false
  }
}

export function logEmailConfigStatus() {
  const provider = getConfiguredProvider()
  const sesConfig = getSesConfig()
  const sendGridConfig = getSendGridConfig()
  const smtpConfig = getSmtpConfig()

  console.log('[EMAIL] Configuration status:')
  console.log(`  Provider: ${provider}`)
  console.log(`  SES: ${sesConfig ? 'configured' : 'missing config'}`)
  console.log(`  SendGrid: ${sendGridConfig ? 'configured' : 'missing config'}`)
  console.log(`  SMTP: ${smtpConfig ? 'configured' : 'missing config'}`)
}

export async function previewEmailTemplate(templateName, values = {}) {
  const mergedValues = withDefaults({ to: values.to || 'demo@hireflow.dev', ...values })
  const html = await renderTemplate(templateName, mergedValues)
  return { html, values: mergedValues }
}

export async function sendVerificationEmail({ to, verificationUrl }) {
  const values = withDefaults({ to, verificationUrl })
  return sendTemplateEmail({ to, subject: 'Verify your HireFlow email', templateName: 'verification', text: `Welcome to HireFlow. Verify your email by visiting: ${verificationUrl}`, values })
}
export async function sendWelcomeEmail({ to }) { const values = withDefaults({ to, dashboardUrl: `${getAppUrl()}/dashboard?utm_source=email&utm_campaign=welcome` }); return sendTemplateEmail({ to, subject: 'Welcome to HireFlow', templateName: 'welcome', text: `Welcome to HireFlow, ${values.firstName}. Your account is verified. Visit your dashboard: ${values.dashboardUrl}`, values }) }
export async function sendInvoiceEmail({ to, invoiceId, amount, invoiceDate, planName }) { const values = withDefaults({ to, invoiceId, amount, invoiceDate, planName, billingUrl: `${getAppUrl()}/billing?utm_source=email&utm_campaign=invoice` }); return sendTemplateEmail({ to, subject: `Your HireFlow invoice ${invoiceId}`, templateName: 'invoice', text: `Payment received for ${planName}. Invoice ${invoiceId}, amount ${amount} on ${invoiceDate}. Manage billing: ${values.billingUrl}`, values }) }
export async function sendCancellationEmail({ to, endsOn }) { const values = withDefaults({ to, endsOn, pricingUrl: `${getAppUrl()}/pricing?utm_source=email&utm_campaign=cancellation` }); return sendTemplateEmail({ to, subject: 'Your HireFlow subscription was cancelled', templateName: 'cancellation', text: `Your subscription has been cancelled and remains active until ${endsOn}. You can reactivate here: ${values.pricingUrl}`, values }) }
export async function sendReengagementEmail({ to }) { const values = withDefaults({ to, dashboardUrl: `${getAppUrl()}/dashboard?utm_source=email&utm_campaign=reengagement` }); return sendTemplateEmail({ to, subject: 'Come back to HireFlow', templateName: 'reengagement', text: `We've added new candidate insights. Return to your dashboard: ${values.dashboardUrl}`, values }) }
export async function sendPasswordResetEmail({ to, firstName, resetUrl }) { const values = withDefaults({ to, firstName, resetUrl }); return sendTemplateEmail({ to, subject: 'Reset Your HireFlow Password', templateName: 'password-reset', text: `Hi ${values.firstName}, reset your password using this link: ${resetUrl}. This link expires in 1 hour.`, values }) }
export async function sendPasswordResetConfirmationEmail({ to, firstName }) { const values = withDefaults({ to, firstName }); return sendTemplateEmail({ to, subject: 'Your HireFlow password was changed', templateName: 'welcome', text: `Hi ${values.firstName}, your password was reset successfully. If this wasn't you, contact support immediately.`, values: { ...values, dashboardUrl: `${getAppUrl()}/login` } }) }
export async function sendDemoRequestConfirmationEmail({ to, requesterName }) { const values = withDefaults({ to, firstName: requesterName || undefined, dashboardUrl: `${getAppUrl()}/about` }); return sendTemplateEmail({ to, subject: 'We received your demo request', templateName: 'welcome', text: `Hi ${values.firstName}, thanks for requesting a demo. Our team will reach out shortly.`, values }) }
export async function sendDemoRequestEmail({ requesterName, requesterEmail, company, phone, message, to = getDemoRequestRecipient(), }) { const values = withDefaults({ to, requesterName, requesterEmail, company, phone: phone || 'Not provided', message, }); return sendTemplateEmail({ to, subject: `New demo request from ${requesterName}`, templateName: 'demo-request', text: ['New demo request submitted.', `Name: ${requesterName}`, `Email: ${requesterEmail}`, `Company: ${company}`, `Phone: ${phone || 'Not provided'}`, `Message: ${message}`,].join('\n'), values, }) }

export const __emailServiceTestUtils = { getConfiguredProvider, getRecipientDomain, getSesConfig }
