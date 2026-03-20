import fs from 'fs/promises'
import path from 'path'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'

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

function getSmtpConfig() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM

  if (!host || !port || !user || !pass || !from) {
    return null
  }

  return { host, port, user, pass, from }
}

function getTransporter() {
  const smtpConfig = getSmtpConfig()

  if (!smtpConfig) {
    if (!missingConfigWarningShown) {
      console.warn('[EMAIL] SMTP config missing. Transactional and campaign emails are disabled.')
      missingConfigWarningShown = true
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

async function sendTemplateEmail({ to, subject, templateName, text, values }) {
  const mailer = getTransporter()

  if (!mailer) {
    return false
  }

  const renderedHtml = await renderTemplate(templateName, values)

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
