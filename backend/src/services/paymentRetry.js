import { pool, logErrorToDatabase } from '../db/client.js'
import { normalizePaddleEnvironment } from '../config/paddle.js'

function getFailureReason(payload) {
  return (
    payload?.data?.status_details?.reason ||
    payload?.data?.error?.message ||
    payload?.error?.message ||
    'Unknown payment failure reason'
  )
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
    payload?.data?.custom_data?.email ||
    payload?.data?.email ||
    payload?.customer_email ||
    payload?.email ||
    null
  )
}

function getUserId(payload) {
  return payload?.data?.custom_data?.userId || payload?.custom_data?.userId || null
}

export async function recordFailedPaymentAttempt(payload, errorMessage = null, paddleEnvironment = null, db = pool) {
  const transactionId = getTransactionId(payload)

  if (!transactionId) {
    await logErrorToDatabase('payment.failure.missing_transaction_id', new Error('Missing transaction id'), {
      payload,
    })
    return null
  }

  const failureReason = errorMessage || getFailureReason(payload)
  const environment = normalizePaddleEnvironment(
    paddleEnvironment
      || payload?.data?.custom_data?.paddleEnvironment
      || payload?.custom_data?.paddleEnvironment,
  )

  const result = await db.query(
    `INSERT INTO payment_attempts (
      transaction_id,
      user_id,
      customer_email,
      amount,
      currency,
      status,
      retry_count,
      next_retry_at,
      last_error,
      payload,
      paddle_environment
    )
    VALUES ($1, $2, $3, $4, $5, 'failed', 0, NULL, $6, $7::jsonb, $8)
    ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL
    DO UPDATE SET
      customer_email = COALESCE(EXCLUDED.customer_email, payment_attempts.customer_email),
      user_id = COALESCE(EXCLUDED.user_id, payment_attempts.user_id),
      amount = COALESCE(EXCLUDED.amount, payment_attempts.amount),
      currency = COALESCE(EXCLUDED.currency, payment_attempts.currency),
      last_error = EXCLUDED.last_error,
      payload = EXCLUDED.payload,
      paddle_environment = EXCLUDED.paddle_environment,
      updated_at = NOW(),
      status = CASE
        WHEN payment_attempts.status = 'succeeded' THEN payment_attempts.status
        ELSE 'failed'
      END,
      next_retry_at = NULL
    RETURNING *`,
    [
      transactionId,
      getUserId(payload),
      getCustomerEmail(payload),
      getTransactionAmount(payload),
      getTransactionCurrency(payload),
      failureReason,
      JSON.stringify(payload),
      environment,
    ],
  )

  return result.rows[0]
}

export async function getFailedPaymentsForAdmin() {
  const result = await pool.query(
    `SELECT id, transaction_id, user_id, customer_email, amount, currency, status, retry_count,
            next_retry_at, last_error, created_at, updated_at
     FROM payment_attempts
     WHERE status IN ('failed', 'retrying', 'manual_required')
     ORDER BY updated_at DESC
     LIMIT 100`,
  )

  return result.rows
}
