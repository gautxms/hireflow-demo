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
