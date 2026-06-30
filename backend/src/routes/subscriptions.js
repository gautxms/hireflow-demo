import { Buffer } from 'node:buffer'
import { Router } from 'express'
import { pool, logErrorToDatabase } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { resolvePaddleConfig } from '../config/paddle.js'

const router = Router()


export const PAYMENT_METHOD_UPDATE_ERROR = 'Payment method updates must be completed through the secure Paddle billing flow.'

export const RAW_PAYMENT_METHOD_FIELDS = [
  'cardNumber',
  'card_number',
  'pan',
  'cvc',
  'cvv',
  'securityCode',
  'security_code',
  'expiryMonth',
  'expiryYear',
  'expMonth',
  'expYear',
]

export function containsRawPaymentMethodField(body = {}) {
  if (!body || typeof body !== 'object') return false
  return RAW_PAYMENT_METHOD_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field))
}

const ERROR_RESPONSES = {
  BILLING_CONFIG_MISSING: { status: 409, message: 'Subscription cannot be changed because billing configuration is missing. Please contact support.' },
  BILLING_PROVIDER_MISSING: { status: 409, message: 'Subscription cannot be changed because billing provider subscription is missing. Please contact support.' },
  PAYMENT_FAILED_OR_ACTION_REQUIRED: { status: 402, message: 'Paddle could not apply this plan change because payment failed or requires action. Please update your payment method or contact support.' },
  PADDLE_SUBSCRIPTION_UPDATE_FAILED: { status: 502, message: 'Paddle could not update your subscription right now. Please try again or contact support if this continues.' },
  PLAN_ALREADY_ACTIVE: { status: 400, message: 'You are already on that plan.' },
  PLAN_CHANGE_NOT_ALLOWED: { status: 403, message: 'This plan change is not available for your subscription. Please contact support.' },
  UNSUPPORTED_BILLING_ITEMS: { status: 409, message: 'Your subscription has recurring add-ons that need support-assisted plan changes. Please contact support so we can update your plan safely.' },
  UNKNOWN: { status: 500, message: 'Unable to change plan' },
}

const BILLING_PROVIDER_MISSING_ERROR = ERROR_RESPONSES.BILLING_PROVIDER_MISSING.message
const PADDLE_PRICE_MISSING_ERROR = ERROR_RESPONSES.BILLING_CONFIG_MISSING.message

const PLAN_CONFIG = {
  monthly: { label: 'Monthly', amountCents: 9900, interval: 'month' },
  annual: { label: 'Annual', amountCents: 99900, interval: 'year' },
}


export function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format((Number(cents) || 0) / 100)
}

export function isoOrNull(value) {
  if (!value) return null
  return new Date(value).toISOString()
}

class BillingError extends Error {
  constructor(code, details = {}) {
    super(ERROR_RESPONSES[code]?.message || ERROR_RESPONSES.UNKNOWN.message)
    this.code = code
    this.details = details
  }
}

function getPaddleRequestId(response) {
  return response.headers?.get?.('request-id') || response.headers?.get?.('paddle-request-id') || response.headers?.get?.('x-request-id') || null
}

function getPaddleErrorCode(payload = {}) {
  return payload?.error?.code || payload?.error_code || payload?.code || null
}

function classifyPaddleFailure(status, payload = {}) {
  const errorCode = String(getPaddleErrorCode(payload) || '').toLowerCase()
  const hasPaymentActionCode = [
    'payment_required',
    'payment_failed',
    'payment_method_required',
    'payment_method_action_required',
    'payment_action_required',
    'transaction_payment_failed',
    'card_declined',
    'authentication_required',
  ].some((code) => errorCode.includes(code))
  const hasConfigCode = [
    'authentication_failed',
    'authorization_failed',
    'invalid_api_key',
    'api_key_invalid',
    'price_not_found',
    'price_id_invalid',
  ].some((code) => errorCode.includes(code))

  if (status === 402 || hasPaymentActionCode) {
    return 'PAYMENT_FAILED_OR_ACTION_REQUIRED'
  }

  if (status === 401 || status === 403 || hasConfigCode) {
    return 'BILLING_CONFIG_MISSING'
  }

  return 'PADDLE_SUBSCRIPTION_UPDATE_FAILED'
}

async function paddleRequest(path, options = {}) {
  const paddle = resolvePaddleConfig()
  if (!paddle.apiKey) {
    throw new BillingError('BILLING_CONFIG_MISSING', { reason: 'missing_api_key' })
  }

  const response = await fetch(`${paddle.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${paddle.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': paddle.apiVersion,
      ...(options.headers || {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new BillingError(classifyPaddleFailure(response.status, payload), {
      paddleStatus: response.status,
      paddleRequestId: getPaddleRequestId(response),
      paddleErrorCode: getPaddleErrorCode(payload),
    })
  }

  return payload
}

function planFromPriceId(priceId, paddle = resolvePaddleConfig()) {
  if (!priceId) return null
  if (priceId === paddle.priceIdsByPlan.monthly) return 'monthly'
  if (priceId === paddle.priceIdsByPlan.annual) return 'annual'
  return null
}

function getSubscriptionItems(subscriptionPayload) {
  return subscriptionPayload?.data?.items || subscriptionPayload?.items || []
}

function getItemPriceId(item = {}) {
  return item?.price?.id || item?.price_id || item?.priceId || null
}

function getItemInterval(item = {}) {
  return item?.price?.billing_cycle?.interval || item?.price?.billingCycle?.interval || item?.billing_cycle?.interval || null
}

function isRecurringNonPlanItem(item, paddle = resolvePaddleConfig()) {
  const priceId = getItemPriceId(item)
  return Boolean(priceId && getItemInterval(item) && !planFromPriceId(priceId, paddle))
}

function assertSupportedRecurringItems(existingItems, targetPlan, paddle = resolvePaddleConfig()) {
  const targetInterval = PLAN_CONFIG[targetPlan]?.interval
  const unsupportedItems = existingItems.filter((item) => {
    if (!isRecurringNonPlanItem(item, paddle)) return false
    const interval = getItemInterval(item)
    return interval && targetInterval && interval !== targetInterval
  })

  if (unsupportedItems.length > 0) {
    throw new BillingError('UNSUPPORTED_BILLING_ITEMS', {
      recurringAddOnCount: unsupportedItems.length,
      targetPlan,
      targetInterval,
    })
  }
}

function buildPlanChangeItems(existingItems, targetPriceId, targetPlan, paddle = resolvePaddleConfig()) {
  assertSupportedRecurringItems(existingItems, targetPlan, paddle)

  let replaced = false
  const items = existingItems.map((item) => {
    const currentPriceId = getItemPriceId(item)
    const existingPlan = planFromPriceId(currentPriceId, paddle)
    if (!replaced && existingPlan) {
      replaced = true
      return { price_id: targetPriceId, quantity: item.quantity || 1 }
    }
    return { price_id: currentPriceId, quantity: item.quantity || 1 }
  }).filter((item) => item.price_id)

  return replaced ? items : [{ price_id: targetPriceId, quantity: 1 }, ...items]
}

function extractBillingDates(paddlePayload = {}) {
  const data = paddlePayload.data || paddlePayload
  return {
    currentPeriodEnd: data?.current_billing_period?.ends_at || data?.billing_period?.ends_at || null,
    nextBillingDate: data?.next_billed_at || data?.current_billing_period?.ends_at || null,
    status: data?.status || null,
    providerSubscriptionId: data?.id || null,
  }
}

function previewDetails(payload = {}) {
  const data = payload.data || payload
  return {
    immediateTransaction: data.immediate_transaction || data.immediateTransaction || null,
    nextTransaction: data.next_transaction || data.nextTransaction || null,
    recurringTransactionDetails: data.recurring_transaction_details || data.recurringTransactionDetails || null,
    updateSummary: data.update_summary || data.updateSummary || null,
  }
}

function sendBillingError(res, error) {
  const code = error instanceof BillingError ? error.code : 'UNKNOWN'
  const response = ERROR_RESPONSES[code] || ERROR_RESPONSES.UNKNOWN
  return res.status(response.status).json({ code, error: response.message })
}

router.get('/current', requireAuth, async (req, res) => {
  try {
    console.info('[subscriptions.current] Loading subscription details', { userId: req.userId })
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_plan, subscription_renewal_date,
              next_billing_date, cancellation_effective_at, current_period_end, subscription_started_at,
              payment_method_brand, payment_method_last4, paddle_customer_id, paddle_subscription_id
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

    const planKey = user.subscription_plan || null
    const plan = planKey ? (PLAN_CONFIG[planKey] || PLAN_CONFIG.monthly) : null
    const hasBillingPortalAccess = Boolean(user.paddle_customer_id && user.paddle_subscription_id)

    return res.json({
      subscription: {
        status: user.subscription_status || 'inactive',
        plan: planKey,
        started_date: isoOrNull(user.subscription_started_at),
        planLabel: plan?.label || null,
        costCents: plan?.amountCents || null,
        costFormatted: plan ? money(plan.amountCents) : null,
        paddleCustomerId: user.paddle_customer_id || null,
        paddleSubscriptionId: user.paddle_subscription_id || null,
        hasBillingPortalAccess,
        renewalDate: isoOrNull(user.subscription_renewal_date || user.current_period_end),
        nextBillingDate: isoOrNull(user.next_billing_date || user.current_period_end),
        cancellationEffectiveAt: isoOrNull(user.cancellation_effective_at),
        paymentMethod: user.payment_method_last4
          ? `${user.payment_method_brand || 'Card'} •••• ${user.payment_method_last4}`
          : hasBillingPortalAccess ? 'Card on file' : null,
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

async function loadPlanChangeContext(userId, targetPlan) {
  if (!PLAN_CONFIG[targetPlan]) {
    throw new BillingError('PLAN_CHANGE_NOT_ALLOWED', { reason: 'invalid_target_plan' })
  }

  const userResult = await pool.query(
    `SELECT id, email, subscription_status, subscription_plan, paddle_subscription_id, current_period_end
     FROM users
     WHERE id = $1`,
    [userId],
  )

  const user = userResult.rows[0]

  if (!user) {
    throw new BillingError('PLAN_CHANGE_NOT_ALLOWED', { reason: 'user_not_found' })
  }

  if (user.subscription_status === 'cancelled') {
    throw new BillingError('PLAN_CHANGE_NOT_ALLOWED', { reason: 'cancelled_subscription' })
  }

  const currentPlan = user.subscription_plan || 'monthly'

  if (currentPlan === targetPlan) {
    throw new BillingError('PLAN_ALREADY_ACTIVE')
  }

  if (!user.paddle_subscription_id) {
    throw new BillingError('BILLING_PROVIDER_MISSING')
  }

  const paddle = resolvePaddleConfig()
  const targetPriceId = targetPlan === 'annual' ? paddle.priceIdsByPlan.annual : paddle.priceIdsByPlan.monthly

  if (!targetPriceId) {
    throw new BillingError('BILLING_CONFIG_MISSING', { reason: 'missing_target_price_id' })
  }

  const subscriptionPayload = await paddleRequest(`/subscriptions/${user.paddle_subscription_id}`)
  const items = buildPlanChangeItems(getSubscriptionItems(subscriptionPayload), targetPriceId, targetPlan, paddle)
  const isUpgrade = currentPlan === 'monthly' && targetPlan === 'annual'

  return {
    user,
    currentPlan,
    targetPlan,
    isUpgrade,
    prorationBillingMode: isUpgrade ? 'prorated_immediately' : 'prorated_next_billing_period',
    items,
    subscriptionPayload,
  }
}

router.post('/change-plan-preview', requireAuth, async (req, res) => {
  const { targetPlan } = req.body || {}

  try {
    const context = await loadPlanChangeContext(req.userId, targetPlan)
    const preview = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}/preview`, {
      method: 'PATCH',
      body: JSON.stringify({
        items: context.items,
        proration_billing_mode: context.prorationBillingMode,
        on_payment_failure: 'prevent_change',
      }),
    })

    return res.json({
      status: 'ok',
      currentPlan: context.currentPlan,
      targetPlan: context.targetPlan,
      paymentMethod: 'Card on file',
      ...previewDetails(preview),
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.change-plan-preview.failed', error, {
      userId: req.userId,
      targetPlan,
      code: error.code || 'UNKNOWN',
      ...error.details,
    })
    return sendBillingError(res, error)
  }
})

router.post('/change-plan', requireAuth, async (req, res) => {
  const { targetPlan } = req.body || {}
  let currentPlan = null

  try {
    const context = await loadPlanChangeContext(req.userId, targetPlan)
    currentPlan = context.currentPlan
    const paddleUpdate = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        items: context.items,
        proration_billing_mode: context.prorationBillingMode,
        on_payment_failure: 'prevent_change',
        custom_data: {
          ...(context.subscriptionPayload?.data?.custom_data || {}),
          plan: targetPlan,
        },
      }),
    })

    const dates = extractBillingDates(paddleUpdate)
    const effectiveAt = context.isUpgrade ? new Date() : new Date(context.user.current_period_end || dates.currentPeriodEnd || Date.now())
    const visiblePlan = context.isUpgrade ? targetPlan : currentPlan

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users
         SET subscription_plan = $1,
             subscription_status = COALESCE($2, subscription_status),
             paddle_subscription_id = COALESCE($3, paddle_subscription_id),
             current_period_end = COALESCE($4, current_period_end),
             next_billing_date = COALESCE($5, next_billing_date),
             updated_at = NOW()
         WHERE id = $6`,
        [visiblePlan, dates.status, dates.providerSubscriptionId, dates.currentPeriodEnd, dates.nextBillingDate, req.userId],
      )

      await client.query(
        `INSERT INTO subscription_change_events (user_id, from_plan, to_plan, change_type, effective_at, prorated_credit_cents, metadata)
         VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb)`,
        [req.userId, currentPlan, targetPlan, context.isUpgrade ? 'upgrade' : 'downgrade', effectiveAt, JSON.stringify({
          source: 'billing_page',
          paddle_subscription_id: dates.providerSubscriptionId || context.user.paddle_subscription_id,
          proration_billing_mode: context.prorationBillingMode,
          immediate: context.isUpgrade,
        })],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }

    return res.json({
      status: 'ok',
      message: context.isUpgrade
        ? 'Plan upgraded successfully. Your billing details have been updated from Paddle.'
        : 'Plan downgrade scheduled for your next billing period. Your current plan stays active until then.',
      effectiveAt: effectiveAt.toISOString(),
      pendingPlan: context.isUpgrade ? null : targetPlan,
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.change-plan.failed', error, {
      userId: req.userId,
      targetPlan,
      currentPlan,
      code: error.code || 'UNKNOWN',
      ...error.details,
    })
    return sendBillingError(res, error)
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

    if (!user.paddle_subscription_id) {
      return res.status(409).json({ error: BILLING_PROVIDER_MISSING_ERROR })
    }

    const effectiveAt = user.current_period_end || new Date()

    await paddleRequest(`/subscriptions/${user.paddle_subscription_id}/cancel`, {
      method: 'POST',
    })

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users
         SET subscription_status = 'cancelled',
             cancellation_effective_at = $1,
             cancellation_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [effectiveAt, reason || null, req.userId],
      )

      await client.query(
        `INSERT INTO subscription_change_events (user_id, from_plan, to_plan, change_type, effective_at, reason, metadata)
         VALUES ($1, $2, NULL, 'cancel', $3, $4, $5::jsonb)`,
        [req.userId, user.subscription_plan || 'monthly', effectiveAt, reason || null, JSON.stringify({ acceptOffer: !!acceptOffer })],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }

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
  return res.status(410).json({
    error: PAYMENT_METHOD_UPDATE_ERROR,
  })
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
