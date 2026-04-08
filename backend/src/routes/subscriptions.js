import { Router } from 'express'
import { pool, logErrorToDatabase } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

const PLAN_CONFIG = {
  monthly: { label: 'Monthly', amountCents: 9900, interval: 'month' },
  annual: { label: 'Annual', amountCents: 94800, interval: 'year' },
}

const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_API_VERSION = process.env.PADDLE_API_VERSION || '1'

function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format((Number(cents) || 0) / 100)
}

function isoOrNull(value) {
  if (!value) return null
  return new Date(value).toISOString()
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

router.get('/current', requireAuth, async (req, res) => {
  try {
    console.info('[subscriptions.current] Loading subscription details', { userId: req.userId })
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_plan, subscription_renewal_date,
              next_billing_date, cancellation_effective_at, current_period_end, subscription_started_at,
              payment_method_brand, payment_method_last4
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]
    const subscriptionResult = await pool.query(
      `SELECT status, created_at
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.userId],
    )
    const latestSubscription = subscriptionResult.rows[0] || null

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!latestSubscription) {
      console.warn('[subscriptions.current] No subscription row found in subscriptions table', { userId: req.userId })
    }

    const planKey = user.subscription_plan || 'monthly'
    const plan = PLAN_CONFIG[planKey] || PLAN_CONFIG.monthly

    return res.json({
      subscription: {
        status: user.subscription_status || 'inactive',
        plan: planKey,
        started_date: isoOrNull(user.subscription_started_at),
        planLabel: plan.label,
        costCents: plan.amountCents,
        costFormatted: money(plan.amountCents),
        renewalDate: isoOrNull(user.subscription_renewal_date || user.current_period_end),
        nextBillingDate: isoOrNull(user.next_billing_date || user.current_period_end),
        cancellationEffectiveAt: isoOrNull(user.cancellation_effective_at),
        paymentMethod: user.payment_method_last4
          ? `${user.payment_method_brand || 'Card'} •••• ${user.payment_method_last4}`
          : 'Card on file',
        latestRecordStatus: latestSubscription?.status || null,
        latestRecordCreatedAt: isoOrNull(latestSubscription?.created_at),
      },
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.current.failed', error, { userId: req.userId })
    return res.status(500).json({ error: 'Unable to load subscription details' })
  }
})

router.get('/history', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, invoice_number, billed_at, amount_cents, currency, status, invoice_pdf_url
       FROM billing_invoices
       WHERE user_id = $1
         AND billed_at >= NOW() - INTERVAL '12 months'
       ORDER BY billed_at DESC`,
      [req.userId],
    )

    return res.json({
      invoices: result.rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        date: isoOrNull(row.billed_at),
        amountCents: row.amount_cents,
        amountFormatted: money(row.amount_cents, row.currency),
        currency: row.currency,
        status: row.status,
        canDownload: Boolean(row.invoice_pdf_url),
      })),
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.history.failed', error, { userId: req.userId })
    return res.status(500).json({ error: 'Unable to load billing history' })
  }
})

router.post('/change-plan', requireAuth, async (req, res) => {
  const { targetPlan } = req.body || {}

  if (!PLAN_CONFIG[targetPlan]) {
    return res.status(400).json({ error: 'targetPlan must be monthly or annual' })
  }

  try {
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_plan, paddle_subscription_id, current_period_end
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.subscription_status === 'cancelled') {
      return res.status(403).json({
        error: 'Re-subscribing to a cancelled plan is disabled. Please contact support.',
      })
    }

    const currentPlan = user.subscription_plan || 'monthly'

    if (currentPlan === targetPlan) {
      return res.status(400).json({ error: 'You are already on that plan.' })
    }

    const isUpgrade = currentPlan === 'monthly' && targetPlan === 'annual'
    const effectiveAt = isUpgrade ? new Date() : new Date(user.current_period_end || Date.now())
    const proratedCreditCents = isUpgrade ? 1500 : 0

    if (user.paddle_subscription_id) {
      const targetPriceId = targetPlan === 'annual' ? process.env.PADDLE_ANNUAL_PRICE_ID : process.env.PADDLE_MONTHLY_PRICE_ID

      if (targetPriceId) {
        await paddleRequest(`/subscriptions/${user.paddle_subscription_id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            items: [{ price_id: targetPriceId, quantity: 1 }],
            proration_billing_mode: isUpgrade ? 'prorated_immediately' : 'prorated_next_billing_period',
          }),
        })
      }
    }

    await pool.query(
      `UPDATE users
       SET subscription_plan = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [targetPlan, req.userId],
    )

    await pool.query(
      `INSERT INTO subscription_change_events (user_id, from_plan, to_plan, change_type, effective_at, prorated_credit_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.userId, currentPlan, targetPlan, isUpgrade ? 'upgrade' : 'downgrade', effectiveAt, proratedCreditCents],
    )

    return res.json({
      status: 'ok',
      message: isUpgrade
        ? 'Plan upgraded. Prorated credit will be applied to your next billing.'
        : 'Plan downgrade scheduled for your next billing period.',
      effectiveAt: effectiveAt.toISOString(),
      proratedCreditCents,
      proratedCreditFormatted: money(proratedCreditCents),
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.change-plan.failed', error, {
      userId: req.userId,
      targetPlan,
    })
    return res.status(500).json({ error: 'Unable to change plan' })
  }
})

router.post('/cancel', requireAuth, async (req, res) => {
  const { reason, acceptOffer } = req.body || {}

  try {
    console.info('[subscriptions.cancel] Cancel request received', { userId: req.userId, reason })
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_plan, paddle_subscription_id, current_period_end
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const effectiveAt = user.current_period_end || new Date()

    if (user.paddle_subscription_id) {
      await paddleRequest(`/subscriptions/${user.paddle_subscription_id}/cancel`, {
        method: 'POST',
      })
    }

    await pool.query(
      `UPDATE users
       SET subscription_status = 'cancelled',
           cancellation_effective_at = $1,
           cancellation_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [effectiveAt, reason || null, req.userId],
    )

    await pool.query(
      `INSERT INTO subscription_change_events (user_id, from_plan, to_plan, change_type, effective_at, reason, metadata)
       VALUES ($1, $2, NULL, 'cancel', $3, $4, $5::jsonb)`,
      [req.userId, user.subscription_plan || 'monthly', effectiveAt, reason || null, JSON.stringify({ acceptOffer: !!acceptOffer })],
    )

    return res.json({
      status: 'ok',
      message: 'Subscription cancelled. A confirmation email will be sent by webhook processing.',
      effectiveAt: new Date(effectiveAt).toISOString(),
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.cancel.failed', error, { userId: req.userId })
    return res.status(500).json({ error: 'Unable to cancel subscription' })
  }
})

router.post('/payment-method', requireAuth, async (req, res) => {
  const { cardNumber, expiryMonth, expiryYear, cvc } = req.body || {}
  const digitsOnly = String(cardNumber || '').replace(/\D/g, '')
  const monthNum = Number(expiryMonth)
  const yearNum = Number(expiryYear)
  const cvcDigits = String(cvc || '').replace(/\D/g, '')

  if (digitsOnly.length < 12 || digitsOnly.length > 19) {
    return res.status(400).json({ error: 'Card number appears invalid' })
  }

  if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ error: 'Expiry month must be 1-12' })
  }

  if (!Number.isInteger(yearNum) || yearNum < new Date().getFullYear()) {
    return res.status(400).json({ error: 'Expiry year is invalid' })
  }

  if (cvcDigits.length < 3 || cvcDigits.length > 4) {
    return res.status(400).json({ error: 'CVC appears invalid' })
  }

  try {
    const last4 = digitsOnly.slice(-4)
    const brand = digitsOnly.startsWith('4') ? 'Visa' : 'Card'

    await pool.query(
      `UPDATE users
       SET payment_method_brand = $1,
           payment_method_last4 = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [brand, last4, req.userId],
    )

    console.info('[subscriptions.payment-method] Updated payment method', { userId: req.userId, brand, last4 })

    return res.json({
      status: 'ok',
      message: 'Payment method updated successfully.',
      paymentMethod: `${brand} •••• ${last4}`,
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.payment-method.failed', error, { userId: req.userId })
    return res.status(500).json({ error: 'Unable to update payment method' })
  }
})

router.get('/invoices/:invoiceId/download', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT invoice_pdf_url, invoice_number
       FROM billing_invoices
       WHERE id = $1 AND user_id = $2`,
      [req.params.invoiceId, req.userId],
    )

    const invoice = result.rows[0]

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    if (!invoice.invoice_pdf_url) {
      return res.status(400).json({ error: 'Invoice PDF is not available' })
    }

    const pdfResponse = await fetch(invoice.invoice_pdf_url)

    if (!pdfResponse.ok) {
      return res.status(502).json({ error: 'Unable to fetch invoice PDF' })
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
    const filename = `${invoice.invoice_number || 'invoice'}.pdf`

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(pdfBuffer)
  } catch (error) {
    await logErrorToDatabase('subscriptions.invoice-download.failed', error, {
      userId: req.userId,
      invoiceId: req.params.invoiceId,
    })
    return res.status(500).json({ error: 'Unable to download invoice' })
  }
})

export default router
