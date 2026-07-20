import { Buffer } from 'node:buffer'
import { Router } from 'express'
import { pool, logErrorToDatabase } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { resolvePaddleConfig, resolvePaddleConfigForUser } from '../config/paddle.js'
import {
  buildPlanChangeCustomData,
  getPlanChangeMetadata,
  inferPlanFromPaddlePayload,
  normalizePaddleSubscriptionItems,
  recoverFailedPaddlePlanChange,
} from '../services/paddlePlanChangeRecovery.js'

const router = Router()


export const PAYMENT_METHOD_UPDATE_ERROR = 'Raw payment details must never be sent to HireFlow. Use the secure Paddle billing flow.'

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
  PLAN_CHANGE_PAYMENT_FAILED_PRESERVED: { status: 402, message: 'The upgrade payment was declined. Your current plan and access remain unchanged.' },
  PADDLE_SUBSCRIPTION_UPDATE_FAILED: { status: 502, message: 'Paddle could not update your subscription right now. Please try again or contact support if this continues.' },
  KEEP_SUBSCRIPTION_FAILED: { status: 500, message: 'Unable to confirm that your subscription will continue. Reload Billing to check the latest status before trying again.' },
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

const SCHEDULED_CANCELLATION_STATUSES = new Set([
  'canceled',
  'cancelled',
  'cancel_scheduled',
  'cancellation_scheduled',
  'pending_cancellation',
  'scheduled_cancellation',
])


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

function dateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isFutureDate(value, now = new Date()) {
  const date = dateOrNull(value)
  const comparisonDate = dateOrNull(now)
  return Boolean(date && comparisonDate && date > comparisonDate)
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function hasScheduledCancellationStatus(status) {
  return SCHEDULED_CANCELLATION_STATUSES.has(normalizeStatus(status))
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

async function paddleRequest(path, options = {}, paddle = resolvePaddleConfig()) {
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
  if (priceId === paddle.noTrialPriceIdsByPlan?.monthly) return 'monthly'
  if (priceId === paddle.noTrialPriceIdsByPlan?.annual) return 'annual'
  if (priceId === paddle.testUpgrade?.annualPriceId) return 'annual'
  if (priceId === paddle.testUpgrade?.monthlyPriceId) return 'monthly'
  if (paddle.legacyPriceIdsByPlan?.monthly?.includes(priceId)) return 'monthly'
  if (paddle.legacyPriceIdsByPlan?.annual?.includes(priceId)) return 'annual'
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

function getItemUnitPrice(item = {}) {
  return item?.price?.unit_price || item?.price?.unitPrice || item?.unit_price || item?.unitPrice || {}
}

function isCreditItem(item = {}) {
  const priceType = String(item?.price?.type || item?.type || '').toLowerCase()
  const productType = String(item?.price?.product?.type || item?.product?.type || '').toLowerCase()
  return priceType === 'credit' || productType === 'credit'
}

function isActiveRecurringItem(item = {}) {
  const status = item.status || item.price?.status || 'active'
  return getItemInterval(item) && status !== 'deleted' && status !== 'canceled' && status !== 'cancelled'
}

function maskPriceId(priceId = '') {
  if (!priceId) return null
  return priceId.length <= 12 ? `${priceId.slice(0, 4)}…${priceId.slice(-3)}` : `${priceId.slice(0, 8)}…${priceId.slice(-4)}`
}

function findBasePlanItemIndex(existingItems, currentPlan, targetPlan, context = {}, paddle = resolvePaddleConfig()) {
  const currentInterval = PLAN_CONFIG[currentPlan]?.interval
  const knownIndex = existingItems.findIndex((item) => planFromPriceId(getItemPriceId(item), paddle) === currentPlan)

  if (knownIndex >= 0) return knownIndex

  const intervalMatches = existingItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isActiveRecurringItem(item) && getItemInterval(item) === currentInterval)

  if (intervalMatches.length === 1) {
    const [{ item, index }] = intervalMatches
    console.info('[subscriptions.change-plan] Treating unrecognized recurring item as current base plan', {
      userId: context.userId,
      paddleSubscriptionId: context.paddleSubscriptionId,
      currentPlan,
      targetPlan,
      itemInterval: getItemInterval(item),
      priceId: maskPriceId(getItemPriceId(item)),
    })
    return index
  }

  return -1
}

function assertSupportedRecurringItems(existingItems, basePlanItemIndex, targetPlan) {
  const targetInterval = PLAN_CONFIG[targetPlan]?.interval
  const unsupportedItems = existingItems.filter((item, index) => {
    if (index === basePlanItemIndex || !isActiveRecurringItem(item)) return false
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

function buildPlanChangeItems(existingItems, targetPriceId, targetPlan, currentPlan, context = {}, paddle = resolvePaddleConfig()) {
  const basePlanItemIndex = findBasePlanItemIndex(existingItems, currentPlan, targetPlan, context, paddle)

  if (basePlanItemIndex < 0) {
    throw new BillingError('UNSUPPORTED_BILLING_ITEMS', { reason: 'base_plan_item_not_found', targetPlan, currentPlan })
  }

  assertSupportedRecurringItems(existingItems, basePlanItemIndex, targetPlan)

  return existingItems.map((item, index) => {
    const currentPriceId = getItemPriceId(item)
    if (index === basePlanItemIndex) {
      return { price_id: targetPriceId, quantity: item.quantity || 1 }
    }
    return { price_id: currentPriceId, quantity: item.quantity || 1 }
  }).filter((item) => item.price_id)
}

function resolveLocalPlanCost(plan) {
  return {
    costCents: plan?.amountCents || null,
    costFormatted: plan ? money(plan.amountCents) : null,
    costCurrencyCode: plan ? 'USD' : null,
    costSource: 'local_fallback',
    billingInterval: plan?.interval || null,
  }
}

function findCurrentBasePlanItem(subscriptionPayload, planKey, paddle = resolvePaddleConfig()) {
  const items = getSubscriptionItems(subscriptionPayload).filter((item) => isActiveRecurringItem(item) && !isCreditItem(item))
  const knownItem = items.find((item) => planFromPriceId(getItemPriceId(item), paddle) === planKey)

  if (knownItem) return knownItem

  const planInterval = PLAN_CONFIG[planKey]?.interval
  const intervalMatches = items.filter((item) => planInterval && getItemInterval(item) === planInterval)
  return intervalMatches.length === 1 ? intervalMatches[0] : null
}

function extractCurrentPaddlePlanCost(subscriptionPayload, planKey, paddle = resolvePaddleConfig()) {
  const item = findCurrentBasePlanItem(subscriptionPayload, planKey, paddle)
  const unitPrice = getItemUnitPrice(item)
  const amount = unitPrice?.amount
  const currencyCode = unitPrice?.currency_code || unitPrice?.currencyCode || null
  const costFormatted = formatMinorUnits(amount, currencyCode)

  if (!costFormatted) return null

  return {
    costCents: Number(amount),
    costFormatted,
    costCurrencyCode: currencyCode,
    costSource: 'paddle',
    billingInterval: getItemInterval(item),
  }
}

async function resolveCurrentPlanCost(user, planKey, plan) {
  const fallback = resolveLocalPlanCost(plan)

  if (!user?.paddle_subscription_id || !planKey) return fallback

  try {
    const paddle = resolvePaddleConfigForUser(user)
    const subscriptionPayload = await paddleRequest(`/subscriptions/${user.paddle_subscription_id}`, {}, paddle)
    return { ...(extractCurrentPaddlePlanCost(subscriptionPayload, planKey, paddle) || fallback), paddleSubscriptionPayload: subscriptionPayload }
  } catch (error) {
    console.warn('[subscriptions.current] Falling back to local plan cost after Paddle subscription lookup failed', {
      userId: user.id,
      paddleSubscriptionId: user.paddle_subscription_id,
      code: error.code || 'UNKNOWN',
    })
    return fallback
  }
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

function hasPaddleScheduledCancellationSignal(paddlePayload = {}) {
  const data = paddlePayload?.data || paddlePayload || {}
  const scheduledChange = data?.scheduled_change || data?.scheduledChange || null
  const scheduledAction = normalizeStatus(scheduledChange?.action || scheduledChange?.type || scheduledChange?.status)

  return Boolean(
    data?.cancel_at_period_end
      || data?.cancelAtPeriodEnd
      || data?.cancellation_scheduled
      || data?.cancellationScheduled
      || scheduledAction.includes('cancel'),
  )
}


function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '') ?? null
}

function isNumericMinorUnit(value) {
  return typeof value === 'string' ? /^-?\d+$/.test(value.trim()) : Number.isInteger(value)
}

function getCurrencyFractionDigits(currencyCode) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits
  } catch {
    return null
  }
}

function formatMinorUnits(value, currencyCode) {
  if (!isNumericMinorUnit(value) || !currencyCode) return null
  const amount = Number(value)
  if (!Number.isSafeInteger(amount)) return null

  const fractionDigits = getCurrencyFractionDigits(currencyCode)
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) return null

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount / (10 ** fractionDigits))
  } catch {
    return null
  }
}

function extractPreviewTransactionAmount(transaction = {}) {
  const details = transaction?.details || {}
  const totals = firstPresent(details?.totals, transaction?.totals, transaction?.items?.[0]?.totals) || {}
  const formattedTotals = firstPresent(details?.formatted_totals, details?.formattedTotals, transaction?.formatted_totals, transaction?.formattedTotals) || {}
  const total = firstPresent(totals?.total, details?.total, transaction?.total)
  const currencyCode = firstPresent(totals?.currency_code, totals?.currencyCode, details?.currency_code, details?.currencyCode, transaction?.currency_code, transaction?.currencyCode)
  const paddleFormattedTotal = firstPresent(formattedTotals?.total, details?.formatted_total, details?.formattedTotal, transaction?.formatted_total, transaction?.formattedTotal)
  const fallbackFormattedTotal = formatMinorUnits(total, currencyCode)

  return {
    rawTotal: total === null ? null : String(total),
    currencyCode,
    amountFormatted: paddleFormattedTotal || fallbackFormattedTotal,
    billingPeriodStart: firstPresent(transaction?.billing_period?.starts_at, transaction?.billingPeriod?.startsAt, details?.billing_period?.starts_at),
    billingPeriodEnd: firstPresent(transaction?.billing_period?.ends_at, transaction?.billingPeriod?.endsAt, details?.billing_period?.ends_at),
    isVerified: Boolean(isNumericMinorUnit(total) && currencyCode && (paddleFormattedTotal || fallbackFormattedTotal)),
  }
}

function previewDetails(payload = {}) {
  const data = payload.data || payload
  const immediateTransaction = data.immediate_transaction || data.immediateTransaction || null
  const nextTransaction = data.next_transaction || data.nextTransaction || null
  const immediate = extractPreviewTransactionAmount(immediateTransaction)
  const next = extractPreviewTransactionAmount(nextTransaction)
  const previewCurrencyCode = immediate.currencyCode || next.currencyCode || null
  const hasVerifiedPreviewAmounts = immediate.isVerified && next.isVerified

  return {
    immediateAmountFormatted: immediate.isVerified ? immediate.amountFormatted : null,
    nextBillingAmountFormatted: next.isVerified ? next.amountFormatted : null,
    nextBillingDate: next.billingPeriodStart || data.next_billed_at || data.nextBilledAt || null,
    previewCurrencyCode,
    hasVerifiedPreviewAmounts,
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
              trial_ends_at, trial_consumed_at,
              payment_method_brand, payment_method_last4, paddle_customer_id, paddle_subscription_id,
              paddle_environment,
              EXISTS (SELECT 1 FROM payment_attempts attempt WHERE attempt.user_id = users.id) AS has_payment_attempts
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const paddle = resolvePaddleConfigForUser(user)
    const subscriptionResult = await pool.query(
      `SELECT status, created_at
       FROM subscriptions
       WHERE user_id = $1
         AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.userId, paddle.environment],
    )
    const latestSubscription = subscriptionResult.rows[0] || null

    if (!latestSubscription) {
      console.warn('[subscriptions.current] No subscription row found in subscriptions table', { userId: req.userId })
    }

    const planKey = user.subscription_plan || null
    const plan = planKey ? (PLAN_CONFIG[planKey] || PLAN_CONFIG.monthly) : null
    const hasBillingPortalAccess = Boolean(user.paddle_customer_id && user.paddle_subscription_id)
    const planCost = await resolveCurrentPlanCost(user, planKey, plan)
    const cancellationEffectiveAt = isoOrNull(user.cancellation_effective_at)
    const hasScheduledCancellationSignal = hasScheduledCancellationStatus(user.subscription_status)
      || hasScheduledCancellationStatus(latestSubscription?.status)
      || hasPaddleScheduledCancellationSignal(planCost.paddleSubscriptionPayload)
    const hasScheduledCancellation = isFutureDate(cancellationEffectiveAt) && hasScheduledCancellationSignal
    const isFinalCancellation = ['canceled', 'cancelled'].includes(normalizeStatus(user.subscription_status))
      && !hasScheduledCancellation

    return res.json({
      subscription: {
        status: user.subscription_status || 'inactive',
        plan: planKey,
        started_date: isoOrNull(user.subscription_started_at),
        planLabel: plan?.label || null,
        costCents: planCost.costCents,
        costFormatted: planCost.costFormatted,
        costCurrencyCode: planCost.costCurrencyCode,
        costSource: planCost.costSource,
        billingInterval: planCost.billingInterval,
        paddleCustomerId: user.paddle_customer_id || null,
        paddleSubscriptionId: user.paddle_subscription_id || null,
        paddleEnvironment: paddle.environment,
        hasBillingPortalAccess,
        trialEligible: !user.trial_consumed_at
          && !user.trial_ends_at
          && !user.subscription_started_at
          && !user.paddle_subscription_id
          && !user.has_payment_attempts
          && ['inactive', 'no_subscription', 'none', 'free', ''].includes(normalizeStatus(user.subscription_status)),
        renewalDate: isFinalCancellation ? null : isoOrNull(user.subscription_renewal_date || user.current_period_end),
        nextBillingDate: isFinalCancellation ? null : isoOrNull(user.next_billing_date || user.current_period_end),
        cancellationEffectiveAt,
        cancelAtPeriodEnd: hasScheduledCancellation,
        paymentMethod: isFinalCancellation ? null : user.payment_method_last4
          ? `${user.payment_method_brand || 'Card'} •••• ${user.payment_method_last4}`
          : hasBillingPortalAccess ? 'Card on file' : null,
        latestRecordStatus: hasScheduledCancellation ? (latestSubscription?.status || 'cancellation_scheduled') : (latestSubscription?.status || null),
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

function resolveTargetPriceId(targetPlan, upgradeTestKey, paddle, context = {}) {
  const testPriceIdByPlan = {
    annual: paddle.testUpgrade?.annualPriceId,
    monthly: paddle.testUpgrade?.monthlyPriceId,
  }
  const testPriceId = testPriceIdByPlan[targetPlan]
  const shouldUseTestPrice = paddle.testUpgrade?.enabled === true
    && Boolean(paddle.testUpgrade?.key)
    && upgradeTestKey === paddle.testUpgrade.key
    && Boolean(testPriceId)

  if (shouldUseTestPrice) {
    console.info('[subscriptions.change-plan] Using gated test price override', {
      userId: context.userId,
      targetPlan,
      priceId: maskPriceId(testPriceId),
    })
    return testPriceId
  }

  return targetPlan === 'annual' ? paddle.priceIdsByPlan.annual : paddle.priceIdsByPlan.monthly
}

async function loadPlanChangeContext(userId, targetPlan, options = {}) {
  if (!PLAN_CONFIG[targetPlan]) {
    throw new BillingError('PLAN_CHANGE_NOT_ALLOWED', { reason: 'invalid_target_plan' })
  }

  const userResult = await pool.query(
    `SELECT id, email, subscription_status, subscription_plan, paddle_subscription_id, current_period_end,
            next_billing_date, subscription_renewal_date, paddle_environment
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

  const paddle = resolvePaddleConfigForUser(user)
  const targetPriceId = resolveTargetPriceId(targetPlan, options.upgradeTestKey, paddle, { userId })

  if (!targetPriceId) {
    throw new BillingError('BILLING_CONFIG_MISSING', { reason: 'missing_target_price_id' })
  }

  const subscriptionPayload = await paddleRequest(`/subscriptions/${user.paddle_subscription_id}`, {}, paddle)
  const subscriptionStatus = subscriptionPayload?.data?.status || subscriptionPayload?.status || null

  if (subscriptionStatus === 'past_due') {
    throw new BillingError('PAYMENT_FAILED_OR_ACTION_REQUIRED', { reason: 'paddle_subscription_past_due' })
  }

  const items = buildPlanChangeItems(getSubscriptionItems(subscriptionPayload), targetPriceId, targetPlan, currentPlan, {
    userId,
    paddleSubscriptionId: user.paddle_subscription_id,
  }, paddle)
  const isUpgrade = currentPlan === 'monthly' && targetPlan === 'annual'

  return {
    user,
    currentPlan,
    targetPlan,
    isUpgrade,
    prorationBillingMode: isUpgrade ? 'prorated_immediately' : 'prorated_next_billing_period',
    items,
    previousItems: normalizePaddleSubscriptionItems(getSubscriptionItems(subscriptionPayload)),
    previousCustomData: subscriptionPayload?.data?.custom_data || subscriptionPayload?.custom_data || {},
    startedAt: new Date(),
    subscriptionPayload,
    paddle,
  }
}

function planChangeMetadataForContext(context, outcome = 'pending') {
  return getPlanChangeMetadata({
    custom_data: buildPlanChangeCustomData(context.previousCustomData, {
      fromPlan: context.currentPlan,
      toPlan: context.targetPlan,
      priorStatus: context.user.subscription_status,
      priorCurrentPeriodEnd: context.user.current_period_end,
      priorNextBillingDate: context.user.next_billing_date,
      priorRenewalDate: context.user.subscription_renewal_date,
      previousItems: context.previousItems,
      startedAt: context.startedAt,
      outcome,
    }),
  })
}

async function restorePreviousPlanEntitlement(userId, context) {
  const priorStatus = ['active', 'trialing'].includes(normalizeStatus(context.user.subscription_status))
    ? normalizeStatus(context.user.subscription_status)
    : 'active'

  await pool.query(
    `UPDATE users
     SET subscription_plan = $1,
         subscription_status = $2,
         current_period_end = $3,
         next_billing_date = $4,
         subscription_renewal_date = $5,
         updated_at = NOW()
     WHERE id = $6`,
    [
      context.currentPlan,
      priorStatus,
      context.user.current_period_end || null,
      context.user.next_billing_date || context.user.current_period_end || null,
      context.user.subscription_renewal_date || context.user.current_period_end || null,
      userId,
    ],
  )
}

async function recoverFailedPlanChange(userId, context) {
  const metadata = planChangeMetadataForContext(context, 'failed')
  if (!metadata) throw new Error('Unable to build plan change recovery metadata')

  const observedPayload = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}`, {}, context.paddle)
  const observedPlan = inferPlanFromPaddlePayload(observedPayload, context.paddle)
  const observedStatus = normalizeStatus(observedPayload?.data?.status || observedPayload?.status)

  if (observedPlan === context.targetPlan && observedStatus === 'active') {
    return { outcome: 'succeeded', payload: observedPayload }
  }

  if (observedPlan === context.targetPlan || observedStatus === 'past_due') {
    await recoverFailedPaddlePlanChange({
      request: (path, options = {}) => paddleRequest(path, options, context.paddle),
      subscriptionId: context.user.paddle_subscription_id,
      metadata,
      existingCustomData: context.previousCustomData,
    })
  }

  await restorePreviousPlanEntitlement(userId, context)
  return { outcome: 'preserved', payload: observedPayload }
}

async function persistSuccessfulPlanChange(userId, context, paddleUpdate) {
  const dates = extractBillingDates(paddleUpdate)
  const effectiveAt = context.isUpgrade ? new Date() : new Date(context.user.current_period_end || dates.currentPeriodEnd || Date.now())
  const visiblePlan = context.isUpgrade ? context.targetPlan : context.currentPlan
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
      [visiblePlan, dates.status, dates.providerSubscriptionId, dates.currentPeriodEnd, dates.nextBillingDate, userId],
    )

    await client.query(
      `INSERT INTO subscription_change_events (user_id, from_plan, to_plan, change_type, effective_at, prorated_credit_cents, metadata)
       VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb)`,
      [userId, context.currentPlan, context.targetPlan, context.isUpgrade ? 'upgrade' : 'downgrade', effectiveAt, JSON.stringify({
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

  return { dates, effectiveAt }
}

router.post('/change-plan-preview', requireAuth, async (req, res) => {
  const { targetPlan, upgradeTestKey } = req.body || {}

  try {
    const context = await loadPlanChangeContext(req.userId, targetPlan, { upgradeTestKey })
    const preview = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}/preview`, {
      method: 'PATCH',
      body: JSON.stringify({
        items: context.items,
        proration_billing_mode: context.prorationBillingMode,
        on_payment_failure: 'prevent_change',
      }),
    }, context.paddle)

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
  const { targetPlan, upgradeTestKey } = req.body || {}
  let currentPlan = null
  let context = null

  try {
    context = await loadPlanChangeContext(req.userId, targetPlan, { upgradeTestKey })
    currentPlan = context.currentPlan
    const planChangeCustomData = buildPlanChangeCustomData(context.previousCustomData, {
      fromPlan: context.currentPlan,
      toPlan: context.targetPlan,
      priorStatus: context.user.subscription_status,
      priorCurrentPeriodEnd: context.user.current_period_end,
      priorNextBillingDate: context.user.next_billing_date,
      priorRenewalDate: context.user.subscription_renewal_date,
      previousItems: context.previousItems,
      startedAt: context.startedAt,
    })
    const paddleUpdate = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        items: context.items,
        proration_billing_mode: context.prorationBillingMode,
        on_payment_failure: 'prevent_change',
        custom_data: { ...planChangeCustomData, paddleEnvironment: context.paddle.environment },
      }),
    }, context.paddle)

    const updateStatus = normalizeStatus(paddleUpdate?.data?.status || paddleUpdate?.status)
    if (context.isUpgrade && updateStatus === 'past_due') {
      throw new BillingError('PLAN_CHANGE_PAYMENT_FAILED_PRESERVED', { reason: 'paddle_returned_past_due' })
    }

    const { effectiveAt } = await persistSuccessfulPlanChange(req.userId, context, paddleUpdate)

    return res.json({
      status: 'ok',
      message: context.isUpgrade
        ? 'Plan upgraded successfully. Your billing details have been updated from Paddle.'
        : 'Plan downgrade scheduled for your next billing period. Your current plan stays active until then.',
      effectiveAt: effectiveAt.toISOString(),
      pendingPlan: context.isUpgrade ? null : targetPlan,
    })
  } catch (error) {
    if (
      context?.isUpgrade
      && error instanceof BillingError
      && ['PAYMENT_FAILED_OR_ACTION_REQUIRED', 'PADDLE_SUBSCRIPTION_UPDATE_FAILED', 'PLAN_CHANGE_PAYMENT_FAILED_PRESERVED'].includes(error.code)
    ) {
      try {
        const reconciliation = await recoverFailedPlanChange(req.userId, context)

        if (reconciliation.outcome === 'succeeded') {
          const { effectiveAt } = await persistSuccessfulPlanChange(req.userId, context, reconciliation.payload)
          return res.json({
            status: 'ok',
            message: 'Plan upgraded successfully. Your billing details have been confirmed with Paddle.',
            effectiveAt: effectiveAt.toISOString(),
            pendingPlan: null,
          })
        }

        return sendBillingError(res, new BillingError('PLAN_CHANGE_PAYMENT_FAILED_PRESERVED'))
      } catch (recoveryError) {
        await restorePreviousPlanEntitlement(req.userId, context).catch(() => {})
        await logErrorToDatabase('subscriptions.change-plan.recovery_failed', recoveryError, {
          userId: req.userId,
          targetPlan,
          currentPlan,
          originalCode: error.code,
        })
        return sendBillingError(res, new BillingError('PLAN_CHANGE_PAYMENT_FAILED_PRESERVED', { recoveryFailed: true }))
      }
    }

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
      `SELECT id, email, subscription_status, subscription_plan, paddle_subscription_id, current_period_end,
              paddle_environment
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

    const paddle = resolvePaddleConfigForUser(user)

    const cancellationPayload = await paddleRequest(`/subscriptions/${user.paddle_subscription_id}/cancel`, {
      method: 'POST',
    }, paddle)
    const cancellationData = cancellationPayload?.data || cancellationPayload || {}
    const scheduledChange = cancellationData?.scheduled_change || cancellationData?.scheduledChange || null
    const effectiveAt = scheduledChange?.effective_at
      || scheduledChange?.effectiveAt
      || cancellationData?.current_billing_period?.ends_at
      || user.current_period_end
      || new Date()
    const providerStatus = normalizeStatus(cancellationData?.status)
    const storedStatus = providerStatus || normalizeStatus(user.subscription_status) || 'active'

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users
         SET subscription_status = $1,
             cancellation_effective_at = $2,
             cancellation_reason = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [storedStatus, effectiveAt, reason || null, req.userId],
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
      message: 'Cancellation scheduled. Full access remains available through the end of the current paid period.',
      effectiveAt: new Date(effectiveAt).toISOString(),
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.cancel.failed', error, { userId: req.userId })
    return res.status(500).json({ error: 'Unable to cancel subscription' })
  }
})

router.post('/keep-subscription', requireAuth, async (req, res) => {
  let providerCancellationRemoved = false

  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status, subscription_plan, paddle_subscription_id, paddle_environment
       FROM users
       WHERE id = $1`,
      [req.userId],
    )
    const user = userResult.rows[0]

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.paddle_subscription_id) return res.status(409).json({ error: BILLING_PROVIDER_MISSING_ERROR })

    const paddle = resolvePaddleConfigForUser(user)
    const currentPayload = await paddleRequest(`/subscriptions/${user.paddle_subscription_id}`, {}, paddle)
    const current = currentPayload?.data || currentPayload || {}
    const providerStatus = normalizeStatus(current.status)
    const scheduledChange = current?.scheduled_change || current?.scheduledChange || null
    const scheduledAction = normalizeStatus(scheduledChange?.action || scheduledChange?.type)

    if (providerStatus === 'canceled' || providerStatus === 'cancelled') {
      return res.status(409).json({
        code: 'SUBSCRIPTION_ALREADY_ENDED',
        error: 'This subscription has already ended. Choose a plan to subscribe again.',
        redirectTo: '/pricing?reason=subscribe_again',
      })
    }

    const providerAlreadyContinuing = !scheduledAction.includes('cancel') && ['active', 'trialing'].includes(providerStatus)

    if (!scheduledAction.includes('cancel') && !providerAlreadyContinuing) {
      return res.status(409).json({
        code: 'NO_SCHEDULED_CANCELLATION',
        error: 'This subscription is not scheduled to cancel.',
      })
    }

    let updatedPayload = currentPayload
    if (!providerAlreadyContinuing) {
      updatedPayload = await paddleRequest(`/subscriptions/${user.paddle_subscription_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduled_change: null }),
      }, paddle)
      providerCancellationRemoved = true
    }
    const updated = updatedPayload?.data || updatedPayload || {}
    const dates = extractBillingDates(updatedPayload)
    const restoredStatus = normalizeStatus(updated.status) || 'active'

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users
         SET subscription_status = $1,
             cancellation_effective_at = NULL,
             cancellation_reason = NULL,
             current_period_end = COALESCE($2, current_period_end),
             next_billing_date = COALESCE($3, next_billing_date),
             updated_at = NOW()
         WHERE id = $4`,
        [restoredStatus, dates.currentPeriodEnd, dates.nextBillingDate, req.userId],
      )
      await client.query(
        `INSERT INTO subscription_change_events (user_id, from_plan, to_plan, change_type, effective_at, metadata)
         VALUES ($1, $2, $2, 'keep_subscription', NOW(), $3::jsonb)`,
        [req.userId, user.subscription_plan || 'monthly', JSON.stringify({
          source: 'billing_page',
          paddle_subscription_id: user.paddle_subscription_id,
          provider_schedule_already_clear: providerAlreadyContinuing,
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
      message: 'Your subscription will continue and your normal renewal schedule has been restored.',
      subscription: {
        status: restoredStatus,
        cancellationEffectiveAt: null,
        nextBillingDate: isoOrNull(dates.nextBillingDate),
      },
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.keep.failed', error, { userId: req.userId })

    if (providerCancellationRemoved) {
      return res.status(202).json({
        status: 'syncing',
        code: 'KEEP_SUBSCRIPTION_SYNC_PENDING',
        message: 'Your subscription will continue. HireFlow is refreshing your billing status.',
      })
    }

    return sendBillingError(res, error instanceof BillingError ? error : new BillingError('KEEP_SUBSCRIPTION_FAILED'))
  }
})

router.post('/payment-method', requireAuth, async (req, res) => {
  if (containsRawPaymentMethodField(req.body)) {
    return res.status(400).json({ error: PAYMENT_METHOD_UPDATE_ERROR })
  }

  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status, paddle_subscription_id, paddle_environment
       FROM users
       WHERE id = $1`,
      [req.userId],
    )
    const user = userResult.rows[0]

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.paddle_subscription_id) return res.status(409).json({ error: BILLING_PROVIDER_MISSING_ERROR })

    const paddle = resolvePaddleConfigForUser(user)
    const payload = await paddleRequest(
      `/subscriptions/${user.paddle_subscription_id}/update-payment-method-transaction`,
      {},
      paddle,
    )
    const transaction = payload?.data || payload || {}
    const transactionId = transaction?.id || null
    const checkoutUrl = transaction?.checkout?.url || transaction?.checkout_url || null

    if (!transactionId) {
      throw new BillingError('PADDLE_SUBSCRIPTION_UPDATE_FAILED', { reason: 'missing_payment_method_transaction_id' })
    }

    return res.json({
      status: 'ok',
      transactionId,
      checkoutUrl,
      clientToken: paddle.clientToken,
      paddleEnvironment: paddle.environment,
      action: ['past_due', 'payment_failed'].includes(normalizeStatus(user.subscription_status))
        ? 'pay_overdue'
        : 'update_payment_method',
    })
  } catch (error) {
    await logErrorToDatabase('subscriptions.payment-method.failed', error, { userId: req.userId })
    return sendBillingError(res, error)
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
