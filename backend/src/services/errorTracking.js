import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { pool } from '../db/client.js'

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'api_key',
])

const REDACTED = '[REDACTED]'

let sentryInitialized = false
let alertMailer = null
let sentryClient = null

function redactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, nestedValue]) => {
      const lowered = key.toLowerCase()
      if (SENSITIVE_KEYS.has(lowered) || lowered.includes('password') || lowered.includes('token')) {
        acc[key] = REDACTED
      } else {
        acc[key] = redactValue(nestedValue)
      }
      return acc
    }, {})
  }

  return value
}

function getAlertMailer() {
  if (alertMailer) {
    return alertMailer
  }

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !port || !user || !pass) {
    return null
  }

  alertMailer = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  return alertMailer
}

export async function initErrorTracking() {
  if (sentryInitialized || !process.env.SENTRY_DSN) {
    return
  }

  try {
    const sentry = await import('@sentry/node')
    sentryClient = sentry
  } catch {
    console.warn('[Error Tracking] @sentry/node not installed. Sentry reporting disabled.')
    return
  }

  sentryClient.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    sendDefaultPii: false,
  })

  sentryInitialized = true
}

function buildErrorType(error) {
  return error?.name || error?.code || 'UnknownError'
}

function buildErrorFingerprint(errorType, endpoint) {
  return crypto.createHash('sha256').update(`${errorType}:${endpoint || 'unknown'}`).digest('hex')
}

async function sendSlackAlert(payload) {
  const webhook = process.env.SLACK_ERROR_WEBHOOK_URL

  if (!webhook) {
    return false
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return response.ok
}

async function sendEmailAlert({ errorId, errorType, endpoint, message }) {
  const to = process.env.ERROR_ALERT_EMAIL_TO
  const from = process.env.SMTP_FROM
  const transporter = getAlertMailer()

  if (!to || !from || !transporter) {
    return false
  }

  await transporter.sendMail({
    from,
    to,
    subject: `[HireFlow] Critical error ${errorType}`,
    text: `Error ID: ${errorId}\nType: ${errorType}\nEndpoint: ${endpoint}\nMessage: ${message}`,
  })

  return true
}

export async function shouldSendCriticalAlert(errorType, endpoint) {
  const recentAlert = await pool.query(
    `SELECT id
     FROM error_logs
     WHERE error_type = $1
       AND endpoint = $2
       AND alert_sent = true
       AND created_at > NOW() - INTERVAL '1 hour'
     LIMIT 1`,
    [errorType, endpoint || 'unknown'],
  )

  return !recentAlert.rows[0]
}

export async function reportError({ error, req, statusCode = 500, source = 'api' }) {
  const safeError = error instanceof Error ? error : new Error(String(error || 'Unknown error'))
  const errorType = buildErrorType(safeError)
  const endpoint = req?.originalUrl || req?.path || 'unknown'
  const method = req?.method || 'unknown'
  const fingerprint = buildErrorFingerprint(errorType, endpoint)

  const context = redactValue({
    query: req?.query || {},
    body: req?.body || {},
    headers: req?.headers || {},
    params: req?.params || {},
    ip: req?.ip,
  })

  let sentryEventId = null
  if (sentryInitialized && sentryClient) {
    sentryEventId = sentryClient.captureException(safeError, {
      tags: { source, endpoint, method, errorType, statusCode: String(statusCode) },
      user: req?.userId ? { id: req.userId } : undefined,
      extra: { context },
      fingerprint: [fingerprint],
    })
  }

  const insertResult = await pool.query(
    `INSERT INTO error_logs (
      error_type,
      source,
      endpoint,
      method,
      status_code,
      user_id,
      message,
      stack,
      request_context,
      sentry_event_id,
      error_fingerprint
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
    RETURNING id`,
    [
      errorType,
      source,
      endpoint,
      method,
      statusCode,
      req?.userId || null,
      safeError.message,
      safeError.stack || null,
      JSON.stringify(context),
      sentryEventId,
      fingerprint,
    ],
  )

  const errorId = insertResult.rows[0]?.id

  if (statusCode >= 500) {
    const shouldAlert = await shouldSendCriticalAlert(errorType, endpoint)

    if (shouldAlert) {
      const summary = `Critical error ${errorType} on ${method} ${endpoint} (errorId: ${errorId})`
      const slackSent = await sendSlackAlert({ text: summary })
      const emailSent = await sendEmailAlert({
        errorId,
        errorType,
        endpoint,
        message: safeError.message,
      })

      if (slackSent || emailSent) {
        await pool.query('UPDATE error_logs SET alert_sent = true WHERE id = $1', [errorId])
      }
    }
  }

  return { errorId, sentryEventId, errorType }
}

export async function archiveOldErrorLogs() {
  await pool.query(
    `UPDATE error_logs
     SET archived_at = NOW()
     WHERE archived_at IS NULL
       AND created_at < NOW() - INTERVAL '90 days'`,
  )
}
