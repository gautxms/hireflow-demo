import { Router } from 'express'
import { pool } from '../../db/client.js'

const router = Router()
const REFUND_WINDOW_DAYS = 30
const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_API_VERSION = process.env.PADDLE_API_VERSION || '1'
const VALID_REASONS = new Set(['cancellation', 'dispute', 'other'])

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
              u.paddle_subscription_id
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

async function handleRefundRequest(req, res) {
  const { subscriptionId } = req.params
  const { reason, amountCents, transactionId, adminId } = req.body || {}

  if (!reason || !VALID_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Valid reason is required' })
  }

  if (!adminId) {
    return res.status(400).json({ error: 'adminId is required for audit logging' })
  }

  try {
    await ensureRefundAuditTable()

    const invoiceResult = await pool.query(
      `SELECT bi.id, bi.paddle_transaction_id, bi.amount_cents, bi.currency, bi.billed_at, bi.user_id,
              u.paddle_subscription_id
       FROM billing_invoices bi
       LEFT JOIN users u ON u.id = bi.user_id
       WHERE (bi.user_id::text = $1 OR u.paddle_subscription_id = $1)
         AND ($2::text IS NULL OR bi.paddle_transaction_id = $2)
       ORDER BY bi.billed_at DESC
       LIMIT 1`,
      [subscriptionId, transactionId || null],
    )

    const invoice = invoiceResult.rows[0]

    if (!invoice) {
      return res.status(404).json({ error: 'No matching invoice found for refund' })
    }

    const now = Date.now()
    const billedAt = new Date(invoice.billed_at).getTime()
    const ageDays = Math.floor((now - billedAt) / (1000 * 60 * 60 * 24))

    if (ageDays > REFUND_WINDOW_DAYS) {
      return res.status(422).json({
        error: `Refund denied: outside ${REFUND_WINDOW_DAYS}-day policy window`,
        billedAt: toIso(invoice.billed_at),
      })
    }

    const refundAmountCents = Number(amountCents || invoice.amount_cents)

    if (!Number.isFinite(refundAmountCents) || refundAmountCents <= 0) {
      return res.status(400).json({ error: 'amountCents must be a positive number' })
    }

    if (refundAmountCents > Number(invoice.amount_cents || 0)) {
      return res.status(400).json({ error: 'Refund amount cannot exceed original transaction amount' })
    }

    const paddleResponse = await paddleRequest('/adjustments', {
      method: 'POST',
      body: JSON.stringify({
        action: 'refund',
        transaction_id: invoice.paddle_transaction_id,
        items: [{ type: 'full', amount: refundAmountCents }],
        reason,
      }),
    })

    const adjustmentId = paddleResponse?.data?.id || null

    await pool.query(
      `INSERT INTO admin_refund_audit (
         subscription_id, user_id, transaction_id, paddle_adjustment_id,
         admin_id, reason, amount_cents, status, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded', $8::jsonb)`,
      [
        invoice.paddle_subscription_id,
        String(invoice.user_id),
        invoice.paddle_transaction_id,
        adjustmentId,
        adminId,
        reason,
        refundAmountCents,
        JSON.stringify({ paddleResponse }),
      ],
    )

    await pool.query(
      `UPDATE billing_invoices
       SET status = CASE WHEN $2::bigint >= amount_cents THEN 'refunded' ELSE status END
       WHERE id = $1`,
      [invoice.id, refundAmountCents],
    )

    return res.status(200).json({
      ok: true,
      message: paddleResponse.skipped
        ? 'Refund logged, but Paddle API key is missing so no external call was made.'
        : 'Refund issued successfully.',
      transactionId: invoice.paddle_transaction_id,
      amountCents: refundAmountCents,
      refundAgeDays: ageDays,
      paddleAdjustmentId: adjustmentId,
      paddle: paddleResponse,
    })
  } catch (error) {
    console.error('[Admin subscriptions] refund failed:', error)
    return res.status(500).json({ error: 'Unable to issue refund' })
  }
}

router.patch('/:subscriptionId/refund', handleRefundRequest)
router.post('/:subscriptionId/refund', handleRefundRequest)

router.post('/:subscriptionId/retry-payment', async (req, res) => {
  const { subscriptionId } = req.params

  try {
    const invoiceResult = await pool.query(
      `SELECT bi.paddle_transaction_id
       FROM billing_invoices bi
       LEFT JOIN users u ON u.id = bi.user_id
       WHERE bi.status IN ('failed', 'past_due', 'open')
         AND (bi.user_id::text = $1 OR u.paddle_subscription_id = $1)
       ORDER BY bi.billed_at DESC
       LIMIT 1`,
      [subscriptionId],
    )

    const invoice = invoiceResult.rows[0]

    if (!invoice?.paddle_transaction_id) {
      return res.status(404).json({ error: 'No failed payment found for this subscription' })
    }

    const retryResponse = await paddleRequest(`/transactions/${invoice.paddle_transaction_id}/charge`, {
      method: 'POST',
      body: JSON.stringify({}),
    })

    return res.json({
      ok: true,
      transactionId: invoice.paddle_transaction_id,
      message: retryResponse?.skipped
        ? 'Retry recorded locally. Paddle key missing, so external charge was not attempted.'
        : 'Retry payment request sent to Paddle.',
      paddle: retryResponse,
    })
  } catch (error) {
    console.error('[Admin subscriptions] retry-payment failed:', error)
    return res.status(500).json({ error: 'Failed to retry payment' })
  }
})

export default router
