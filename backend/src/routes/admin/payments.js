import crypto from 'crypto'
import { Router } from 'express'
import { pool } from '../../db/client.js'

const router = Router()
const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_API_VERSION = process.env.PADDLE_API_VERSION || '1'

function toIso(value) {
  if (!value) return null
  return new Date(value).toISOString()
}

async function ensureRefundAuditTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_refund_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id TEXT,
      user_id TEXT,
      transaction_id TEXT,
      paddle_adjustment_id TEXT,
      admin_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'succeeded',
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)
}

async function paddleRequest(path, options = {}) {
  if (!process.env.PADDLE_API_KEY) {
    return { skipped: true, reason: 'PADDLE_API_KEY missing' }
  }

  const response = await fetch(`${PADDLE_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
      'Paddle-Version': PADDLE_API_VERSION,
      ...(options.headers || {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(`Paddle API error (${response.status}): ${JSON.stringify(payload)}`)
  }

  return payload
}

router.get('/', async (_req, res) => {
  try {
    await ensureRefundAuditTable()

    const transactionsResult = await pool.query(
      `SELECT bi.id,
              bi.user_id,
              u.email,
              bi.paddle_transaction_id,
              bi.invoice_number,
              bi.amount_cents,
              bi.currency,
              bi.status,
              bi.billed_at,
              pa.retry_count,
              pa.next_retry_at,
              pa.last_error,
              pa.status AS retry_status
       FROM billing_invoices bi
       LEFT JOIN users u ON u.id = bi.user_id
       LEFT JOIN payment_attempts pa ON pa.transaction_id = bi.paddle_transaction_id
       ORDER BY bi.billed_at DESC
       LIMIT 500`,
    )

    const failedResult = await pool.query(
      `SELECT id, transaction_id, user_id, customer_email, amount, currency, status, retry_count,
              next_retry_at, last_error, created_at, updated_at
       FROM payment_attempts
       WHERE status IN ('failed', 'retrying', 'manual_required')
       ORDER BY updated_at DESC
       LIMIT 100`,
    )

    const refundResult = await pool.query(
      `SELECT id, admin_id, user_id, transaction_id, reason, amount_cents, created_at
       FROM admin_refund_audit
       ORDER BY created_at DESC
       LIMIT 100`,
    )

    const summaryResult = await pool.query(
      `SELECT
          COALESCE(SUM(CASE WHEN subscription_status IN ('active', 'trialing') AND subscription_plan = 'monthly' THEN 99 ELSE 0 END), 0) AS mrr,
          COALESCE(SUM(CASE WHEN subscription_status IN ('active', 'trialing') AND subscription_plan = 'annual' THEN 948 ELSE 0 END), 0) AS annualized_monthly,
          COUNT(*) FILTER (WHERE subscription_status = 'cancelled')::int AS cancelled_count,
          COUNT(*) FILTER (WHERE subscription_status IN ('active', 'trialing'))::int AS active_count
       FROM users`,
    )

    const metrics = summaryResult.rows[0] || {}
    const mrr = Number(metrics.mrr || 0) + Number(metrics.annualized_monthly || 0)
    const arr = mrr * 12
    const churn = Number(metrics.active_count || 0) > 0
      ? (Number(metrics.cancelled_count || 0) / (Number(metrics.active_count) + Number(metrics.cancelled_count || 0))) * 100
      : 0

    return res.json({
      revenueSummary: {
        mrr,
        arr,
        churnRate: Number(churn.toFixed(2)),
      },
      transactions: transactionsResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        transactionId: row.paddle_transaction_id,
        invoiceNumber: row.invoice_number,
        amountCents: Number(row.amount_cents || 0),
        currency: row.currency,
        status: row.status,
        billedAt: toIso(row.billed_at),
        retry: row.retry_status
          ? {
            status: row.retry_status,
            retryCount: Number(row.retry_count || 0),
            nextRetryAt: toIso(row.next_retry_at),
            lastError: row.last_error,
          }
          : null,
      })),
      failedPayments: failedResult.rows.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        userId: row.user_id,
        customerEmail: row.customer_email,
        amount: Number(row.amount || 0),
        currency: row.currency,
        status: row.status,
        retryCount: Number(row.retry_count || 0),
        nextRetryAt: toIso(row.next_retry_at),
        lastError: row.last_error,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      })),
      auditTrail: refundResult.rows.map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        userId: row.user_id,
        transactionId: row.transaction_id,
        reason: row.reason,
        amountCents: Number(row.amount_cents || 0),
        createdAt: toIso(row.created_at),
      })),
    })
  } catch (error) {
    console.error('[Admin payments] list failed:', error)
    return res.status(500).json({ error: 'Unable to load payment data' })
  }
})

router.post('/:transactionId/retry', async (req, res) => {
  const { transactionId } = req.params

  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId is required' })
  }

  try {
    const idempotencyKey = crypto.createHash('sha256').update(`${transactionId}:${Date.now()}`).digest('hex')

    const paddleResponse = await paddleRequest(`/transactions/${transactionId}/charge`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({}),
    })

    await pool.query(
      `UPDATE payment_attempts
       SET status = 'succeeded',
           next_retry_at = NULL,
           updated_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
       WHERE transaction_id = $1`,
      [transactionId, JSON.stringify({ resolved_by: 'admin_retry', retried_at: new Date().toISOString() })],
    )

    return res.json({
      ok: true,
      message: paddleResponse.skipped
        ? 'Retry recorded, but Paddle API key is missing so no external retry was sent.'
        : 'Retry request sent to Paddle.',
      paddle: paddleResponse,
    })
  } catch (error) {
    console.error('[Admin payments] retry failed:', error)
    return res.status(500).json({ error: 'Retry failed' })
  }
})

export default router
