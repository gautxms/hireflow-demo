import crypto from 'crypto'
import { pool, logErrorToDatabase } from '../db/client.js'

const RETRY_DELAYS_HOURS = [1, 24, 24 * 7]
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_HOURS.length

function getSupportEmail() {
  return process.env.PAYMENT_SUPPORT_EMAIL || process.env.SMTP_FROM || 'support@hireflow.dev'
}

function getFailureReason(payload) {
  return (
    payload?.data?.status_details?.reason ||
    payload?.data?.error?.message ||
    payload?.error?.message ||
    'Unknown payment failure reason'
  )
}

function getErrorCode(payload) {
  return payload?.data?.status_details?.code || payload?.data?.error?.code || payload?.error_code || null
}

function getTransactionId(payload) {
  return payload?.data?.id || payload?.transaction_id || payload?.id || null
}

function getTransactionAmount(payload) {
  return payload?.data?.details?.totals?.grand_total || payload?.data?.amount || null
}

function getTransactionCurrency(payload) {
  return payload?.data?.currency_code || payload?.currency_code || payload?.data?.currency || null
}

function getCustomerEmail(payload) {
  return (
    payload?.data?.customer?.email ||
    payload?.data?.email ||
    payload?.customer_email ||
    payload?.email ||
    null
  )
}

function getUserId(payload) {
  return payload?.data?.custom_data?.userId || payload?.custom_data?.userId || null
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

function getNextRetryAtFromRetryCount(retryCount) {
  if (retryCount >= MAX_RETRY_ATTEMPTS) {
    return null
  }

  return addHours(new Date(), RETRY_DELAYS_HOURS[retryCount])
}

async function sendSlackAlert(message, details) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    return false
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${message}\n\n${details}`,
      }),
    })

    return response.ok
  } catch (error) {
    await logErrorToDatabase('slack.alert.failed', error, { message, details })
    return false
  }
}

async function sendSupportEmail(subject, textBody) {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM

  if (!host || !port || !user || !pass || !from) {
    return false
  }

  const nodemailer = await import('nodemailer')

  try {
    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })

    await transporter.sendMail({
      from,
      to: getSupportEmail(),
      subject,
      text: textBody,
    })

    return true
  } catch (error) {
    await logErrorToDatabase('email.alert.failed', error, { subject })
    return false
  }
}

async function alertManualInterventionNeeded(attempt) {
  const subject = `[HireFlow] Payment failed after ${MAX_RETRY_ATTEMPTS} retries`
  const details = [
    `Payment record ID: ${attempt.id}`,
    `Transaction ID: ${attempt.transaction_id}`,
    `User ID: ${attempt.user_id || 'n/a'}`,
    `Customer email: ${attempt.customer_email || 'n/a'}`,
    `Retry count: ${attempt.retry_count}`,
    `Last error: ${attempt.last_error || 'n/a'}`,
  ].join('\n')

  await Promise.all([
    sendSupportEmail(subject, details),
    sendSlackAlert(':warning: Payment failed after max retries', details),
  ])
}

export async function notifySupportPaymentFailedScheduled(attempt) {
  const subject = '[HireFlow] Payment failed - automatic retry scheduled'
  const text = [
    `Transaction ID: ${attempt.transaction_id}`,
    `User ID: ${attempt.user_id || 'n/a'}`,
    `Error code: ${attempt.error_code || 'n/a'}`,
    `Error: ${attempt.last_error || 'n/a'}`,
    `Next retry at: ${attempt.next_retry_at || 'n/a'}`,
  ].join('\n')

  await Promise.all([
    sendSupportEmail(subject, text),
    sendSlackAlert(':warning: Payment failed, retry scheduled', text),
  ])
}

export async function recordFailedPaymentAttempt(payload, errorMessage = null) {
  const transactionId = getTransactionId(payload)

  if (!transactionId) {
    await logErrorToDatabase('payment.failure.missing_transaction_id', new Error('Missing transaction id'), {
      payload,
    })
    return null
  }

  const retryAt = getNextRetryAtFromRetryCount(0)
  const failureReason = errorMessage || getFailureReason(payload)
  const errorCode = getErrorCode(payload)

  const result = await pool.query(
    `INSERT INTO payment_attempts (
      transaction_id,
      user_id,
      customer_email,
      amount,
      currency,
      status,
      retry_count,
      max_retries,
      next_retry_at,
      last_attempted_at,
      error_code,
      last_error,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, 'failed', 0, $6, $7, NOW(), $8, $9, $10::jsonb)
    ON CONFLICT (transaction_id)
    DO UPDATE SET
      customer_email = COALESCE(EXCLUDED.customer_email, payment_attempts.customer_email),
      user_id = COALESCE(EXCLUDED.user_id, payment_attempts.user_id),
      amount = COALESCE(EXCLUDED.amount, payment_attempts.amount),
      currency = COALESCE(EXCLUDED.currency, payment_attempts.currency),
      error_code = EXCLUDED.error_code,
      last_error = EXCLUDED.last_error,
      payload = EXCLUDED.payload,
      max_retries = EXCLUDED.max_retries,
      last_attempted_at = NOW(),
      updated_at = NOW(),
      status = CASE
        WHEN payment_attempts.status = 'succeeded' THEN payment_attempts.status
        ELSE 'failed'
      END,
      next_retry_at = CASE
        WHEN payment_attempts.status = 'succeeded' THEN payment_attempts.next_retry_at
        ELSE EXCLUDED.next_retry_at
      END
    RETURNING *`,
    [
      transactionId,
      getUserId(payload),
      getCustomerEmail(payload),
      getTransactionAmount(payload),
      getTransactionCurrency(payload),
      MAX_RETRY_ATTEMPTS,
      retryAt,
      errorCode,
      failureReason,
      JSON.stringify(payload),
    ],
  )

  return result.rows[0]
}

async function hasActiveSubscription(userId) {
  if (!userId) {
    return false
  }

  const result = await pool.query(
    `SELECT 1 FROM users
     WHERE id = $1
       AND subscription_status IN ('active', 'trialing')
     LIMIT 1`,
    [userId],
  )

  return result.rowCount > 0
}

async function retryPaddleTransaction(attempt) {
  const apiKey = process.env.PADDLE_API_KEY

  if (!apiKey) {
    throw new Error('PADDLE_API_KEY missing; cannot retry payment')
  }

  const idempotencyKey = crypto
    .createHash('sha256')
    .update(`${attempt.transaction_id}:${attempt.retry_count + 1}`)
    .digest('hex')

  const response = await fetch('https://api.paddle.com/transactions/' + attempt.transaction_id + '/charge', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Paddle retry failed (${response.status}): ${body}`)
  }

  return true
}

async function markAttemptAsSucceeded(id, metadata = {}) {
  await pool.query(
    `UPDATE payment_attempts
     SET status = 'succeeded',
         next_retry_at = NULL,
         last_attempted_at = NOW(),
         updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [id, JSON.stringify(metadata)],
  )
}

async function markAttemptAsRetriableFailure(attempt, error) {
  const nextRetryCount = attempt.retry_count + 1
  const isFinalFailure = nextRetryCount >= MAX_RETRY_ATTEMPTS

  if (isFinalFailure) {
    const result = await pool.query(
      `UPDATE payment_attempts
       SET retry_count = $2,
           status = 'manual_required',
           next_retry_at = NULL,
           last_attempted_at = NOW(),
           last_error = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [attempt.id, nextRetryCount, error.message],
    )

    await alertManualInterventionNeeded(result.rows[0])
    return
  }

  const nextRetryAt = getNextRetryAtFromRetryCount(nextRetryCount)

  await pool.query(
    `UPDATE payment_attempts
     SET retry_count = $2,
         status = 'failed',
         next_retry_at = $3,
         last_attempted_at = NOW(),
         last_error = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [attempt.id, nextRetryCount, nextRetryAt, error.message],
  )
}

export async function retryFailedPayments() {
  const dueAttempts = await pool.query(
    `SELECT *
     FROM payment_attempts
     WHERE status IN ('failed', 'retrying')
       AND retry_count < COALESCE(max_retries, $1)
       AND next_retry_at IS NOT NULL
       AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT 50`,
    [MAX_RETRY_ATTEMPTS],
  )

  for (const attempt of dueAttempts.rows) {
    try {
      const alreadySucceeded = await pool.query(
        `SELECT 1 FROM payment_attempts WHERE transaction_id = $1 AND status = 'succeeded' LIMIT 1`,
        [attempt.transaction_id],
      )

      if (alreadySucceeded.rowCount > 0) {
        continue
      }

      if (await hasActiveSubscription(attempt.user_id)) {
        await markAttemptAsSucceeded(attempt.id, {
          resolved_by: 'automatic_skip_active_subscription',
        })
        continue
      }

      await pool.query(
        `UPDATE payment_attempts
         SET status = 'retrying',
             last_attempted_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [attempt.id],
      )

      await retryPaddleTransaction(attempt)
      await markAttemptAsSucceeded(attempt.id, { resolved_by: 'automatic_retry' })
    } catch (error) {
      await logErrorToDatabase('payment.retry.failed', error, {
        attemptId: attempt.id,
        transactionId: attempt.transaction_id,
        retryCount: attempt.retry_count,
      })
      await markAttemptAsRetriableFailure(attempt, error)
    }
  }

  return dueAttempts.rowCount
}

export async function getRecentFailureVolume(hours = 1) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS failure_count
     FROM payment_attempts
     WHERE status IN ('failed', 'manual_required')
       AND updated_at >= NOW() - ($1::text || ' hours')::interval`,
    [hours],
  )

  return result.rows[0]?.failure_count || 0
}

export async function alertSupportIfHighFailureVolume() {
  const failureCount = await getRecentFailureVolume(1)

  if (failureCount <= 5) {
    return false
  }

  const subject = '[HireFlow] High payment failure volume detected'
  const text = `Detected ${failureCount} failed/manual-required payment records in the last hour.`

  await Promise.all([
    sendSupportEmail(subject, text),
    sendSlackAlert(':rotating_light: High payment failure volume detected', text),
  ])

  return true
}

export async function getFailedPaymentsForAdmin() {
  const result = await pool.query(
    `SELECT id, transaction_id, user_id, customer_email, amount, currency, status, retry_count,
            max_retries, next_retry_at, last_attempted_at, error_code, last_error, created_at, updated_at
     FROM payment_attempts
     WHERE status IN ('failed', 'retrying', 'manual_required')
     ORDER BY updated_at DESC
     LIMIT 100`,
  )

  return result.rows
}
