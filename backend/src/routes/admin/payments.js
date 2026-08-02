import { Router } from 'express'
import { pool } from '../../db/client.js'

const router = Router()

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
              pa.status AS retry_status,
              COALESCE(pa.paddle_environment, u.paddle_environment, 'production') AS paddle_environment
       FROM billing_invoices bi
       LEFT JOIN users u ON u.id = bi.user_id
       LEFT JOIN payment_attempts pa ON pa.transaction_id = bi.paddle_transaction_id
       ORDER BY bi.billed_at DESC
       LIMIT 500`,
    )

    const failedResult = await pool.query(
      `SELECT id, transaction_id, user_id, customer_email, amount, currency, status, retry_count,
              next_retry_at, last_error, paddle_environment, created_at, updated_at
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
          COALESCE(SUM(CASE WHEN subscription_status IN ('active', 'trialing') AND subscription_plan = 'annual' THEN 999.0 / 12 ELSE 0 END), 0) AS annualized_monthly,
          COUNT(*) FILTER (WHERE subscription_status = 'cancelled')::int AS cancelled_count,
          COUNT(*) FILTER (WHERE subscription_status IN ('active', 'trialing'))::int AS active_count
       FROM users
       WHERE COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = 'production'`,
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
        paddleEnvironment: row.paddle_environment || 'production',
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
        paddleEnvironment: row.paddle_environment || 'production',
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

router.post('/:transactionId/retry', (_req, res) => {
  return res.status(410).json({
    error: 'Payment collection and retries are managed by Paddle.',
    code: 'PADDLE_MANAGED_PAYMENT_RECOVERY',
  })
})

export default router
