import nodemailer from 'nodemailer'

let mailerWarningShown = false
let transporter

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
    if (!mailerWarningShown) {
      console.warn('[MAILER] SMTP config missing. Verification emails are disabled.')
      mailerWarningShown = true
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

export async function sendVerificationEmail({ to, verificationUrl }) {
  const mailer = getTransporter()

  if (!mailer) {
    return false
  }

  const { smtpConfig } = mailer

  try {
    await mailer.transporter.sendMail({
      from: smtpConfig.from,
      to,
      subject: 'Verify your HireFlow email',
      text: `Welcome to HireFlow. Verify your email by visiting: ${verificationUrl}`,
      html: `<p>Welcome to HireFlow.</p><p>Verify your email by clicking <a href="${verificationUrl}">this link</a>.</p>`,
    })

    return true
  } catch (error) {
    console.warn('[MAILER] Failed to send verification email:', error.message)
    return false
  }
}

export async function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  const mailer = getTransporter()

  if (!mailer) {
    return false
  }

  const { smtpConfig } = mailer
  const safeFirstName = firstName || 'there'

  try {
    await mailer.transporter.sendMail({
      from: smtpConfig.from,
      to,
      subject: 'Reset Your HireFlow Password',
      text: `Hi ${safeFirstName},\n\nWe received a request to reset your HireFlow password.\nIf you didn't make this request, ignore this email.\n\nClick the link below to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\n— The HireFlow Team`,
      html: `<p>Hi ${safeFirstName},</p><p>We received a request to reset your HireFlow password.<br />If you didn't make this request, ignore this email.</p><p>Click the link below to reset your password:<br /><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p><p>— The HireFlow Team</p>`,
    })

    return true
  } catch (error) {
    console.warn('[MAILER] Failed to send password reset email:', error.message)
    return false
  }
}

export async function sendPasswordResetConfirmationEmail({ to, firstName }) {
  const mailer = getTransporter()

  if (!mailer) {
    return false
  }

  const { smtpConfig } = mailer
  const safeFirstName = firstName || 'there'

  try {
    await mailer.transporter.sendMail({
      from: smtpConfig.from,
      to,
      subject: 'Your HireFlow password was changed',
      text: `Hi ${safeFirstName},\n\nYour HireFlow password has been reset successfully.\nIf this wasn't you, contact support immediately.\n\n— The HireFlow Team`,
      html: `<p>Hi ${safeFirstName},</p><p>Your HireFlow password has been reset successfully.</p><p>If this wasn't you, contact support immediately.</p><p>— The HireFlow Team</p>`,
    })

    return true
  } catch (error) {
    console.warn('[MAILER] Failed to send password reset confirmation email:', error.message)
    return false
  }
}
