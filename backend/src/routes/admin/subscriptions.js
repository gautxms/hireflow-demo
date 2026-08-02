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

router.get('/', async (req, res) => {
  const { status, plan, startDate, endDate } = req.query

  const where = []
  const params = []

  if (status && status !== 'all') {
    params.push(status)
    where.push(`u.subscription_status = $${params.length}`)
  }

  if (plan && plan !== 'all') {
    params.push(plan)
    where.push(`u.subscription_plan = $${params.length}`)
  }

  if (startDate) {
    params.push(startDate)
    where.push(`u.subscription_started_at >= $${params.length}::timestamp`)
  }

  if (endDate) {
    params.push(endDate)
    where.push(`u.subscription_started_at <= $${params.length}::timestamp`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const result = await pool.query(
      `SELECT u.id,
              u.email,
              u.subscription_status,
              u.subscription_plan,
              u.subscription_started_at,
              u.subscription_renewal_date,
              u.cancellation_effective_at,
              u.paddle_subscription_id,
              u.paddle_environment,
              COALESCE(last_invoice.amount_cents, 0) AS latest_amount_cents,
              last_invoice.currency AS latest_currency,
              last_invoice.billed_at AS latest_billed_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT bi.amount_cents, bi.currency, bi.billed_at, bi.paddle_transaction_id
         FROM billing_invoices bi
         WHERE bi.user_id = u.id
         ORDER BY bi.billed_at DESC
         LIMIT 1
       ) last_invoice ON true
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT 500`,
      params,
    )

    return res.json({
      subscriptions: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        status: row.subscription_status || 'inactive',
        plan: row.subscription_plan || 'monthly',
        startedAt: toIso(row.subscription_started_at),
        renewalDate: toIso(row.subscription_renewal_date),
        cancellationEffectiveAt: toIso(row.cancellation_effective_at),
        paddleSubscriptionId: row.paddle_subscription_id,
        paddleEnvironment: row.paddle_environment || 'production',
        latestAmountCents: Number(row.latest_amount_cents || 0),
        latestCurrency: row.latest_currency || 'USD',
        latestBilledAt: toIso(row.latest_billed_at),
        latestTransactionId: row.paddle_transaction_id || null,
      })),
    })
  } catch (error) {
    console.error('[Admin subscriptions] list failed:', error)
    return res.status(500).json({ error: 'Unable to load subscriptions' })
  }
})

router.get('/:subscriptionId', async (req, res) => {
  const { subscriptionId } = req.params

  try {
    await ensureRefundAuditTable()

    const userResult = await pool.query(
      `SELECT u.id,
              u.email,
              u.subscription_status,
              u.subscription_plan,
              u.subscription_started_at,
              u.subscription_renewal_date,
              u.next_billing_date,
              u.current_period_end,
              u.cancellation_effective_at,
              u.cancellation_reason,
              u.paddle_subscription_id,
              u.paddle_environment
       FROM users u
       WHERE u.id::text = $1 OR u.paddle_subscription_id = $1
       LIMIT 1`,
      [subscriptionId],
    )

    if (!userResult.rows[0]) {
      return res.status(404).json({ error: 'Subscription not found' })
    }

    const subscription = userResult.rows[0]

    const invoiceResult = await pool.query(
      `SELECT id, paddle_transaction_id, invoice_number, billed_at, amount_cents, currency, status
       FROM billing_invoices
       WHERE user_id = $1
       ORDER BY billed_at DESC
       LIMIT 50`,
      [subscription.id],
    )

    const auditResult = await pool.query(
      `SELECT id, admin_id, reason, amount_cents, status, transaction_id, paddle_adjustment_id, created_at
       FROM admin_refund_audit
       WHERE user_id = $1::text OR subscription_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [String(subscription.id), subscription.paddle_subscription_id || null],
    )

    return res.json({
      subscription: {
        id: subscription.id,
        email: subscription.email,
        status: subscription.subscription_status,
        plan: subscription.subscription_plan,
        startedAt: toIso(subscription.subscription_started_at),
        renewalDate: toIso(subscription.subscription_renewal_date),
        nextBillingDate: toIso(subscription.next_billing_date || subscription.current_period_end),
        cancellationEffectiveAt: toIso(subscription.cancellation_effective_at),
        cancellationReason: subscription.cancellation_reason,
        paddleSubscriptionId: subscription.paddle_subscription_id,
        paddleEnvironment: subscription.paddle_environment || 'production',
      },
      transactions: invoiceResult.rows.map((row) => ({
        id: row.id,
        transactionId: row.paddle_transaction_id,
        invoiceNumber: row.invoice_number,
        billedAt: toIso(row.billed_at),
        amountCents: Number(row.amount_cents || 0),
        currency: row.currency,
        status: row.status,
      })),
      refundAuditTrail: auditResult.rows.map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        reason: row.reason,
        amountCents: Number(row.amount_cents || 0),
        status: row.status,
        transactionId: row.transaction_id,
        paddleAdjustmentId: row.paddle_adjustment_id,
        createdAt: toIso(row.created_at),
      })),
    })
  } catch (error) {
    console.error('[Admin subscriptions] details failed:', error)
    return res.status(500).json({ error: 'Unable to load subscription details' })
  }
})

function handleRefundRequest(_req, res) {
  return res.status(410).json({
    error: 'Refunds are not available through HireFlow.',
    code: 'ADMIN_REFUNDS_UNAVAILABLE',
  })
}

router.patch('/:subscriptionId/refund', handleRefundRequest)
router.post('/:subscriptionId/refund', handleRefundRequest)

router.post('/:subscriptionId/retry-payment', (_req, res) => {
  return res.status(410).json({
    error: 'Payment collection and retries are managed by Paddle.',
    code: 'PADDLE_MANAGED_PAYMENT_RECOVERY',
  })
})

export default router
