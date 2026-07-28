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
  PaddlePlanChangeRecoveryError,
  PLAN_CHANGE_RECOVERY_OUTCOME,
  recoverFailedPaddlePlanChange,
} from '../services/paddlePlanChangeRecovery.js'
import {
  isRecoveryBillingAdjustmentEnabled,
  runRecoveryBillingAdjustments,
  selectAuthoritativeCapture,
} from '../services/recoveryBillingAdjustment.js'
import {
  inspectPaddleSubscriptionForReconciliation,
  reconcilePaddleSubscriptionState,
} from '../services/paddleSubscriptionReconciliation.js'

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
  PLAN_CHANGE_RECOVERY_FAILED: { status: 500, message: 'Unable to confirm that your current plan was restored. Reload Billing to check the latest status before trying again.' },
  PADDLE_SUBSCRIPTION_UPDATE_FAILED: { status: 502, message: 'Paddle could not update your subscription right now. Please try again or contact support if this continues.' },
  KEEP_SUBSCRIPTION_FAILED: { status: 500, message: 'Unable to confirm that your subscription will continue. Reload Billing to check the latest status before trying again.' },
  CANCELLATION_CHANGE_CONFLICT: { status: 409, message: 'Another subscription change is already scheduled. Reload Billing or contact support before cancelling.' },
  CANCELLATION_NOT_ALLOWED_PAST_DUE: { status: 409, message: 'This subscription has an overdue payment. Resolve the payment or contact support before cancelling.' },
  CANCELLATION_NOT_ALLOWED_PAUSED: { status: 409, message: 'Paused subscriptions cannot be scheduled to cancel from HireFlow. Contact support for help with this subscription.' },
  CANCELLATION_NOT_AVAILABLE: { status: 409, message: 'Cancellation is not available for the current subscription state. Reload Billing or contact support.' },
  CANCELLATION_PROVIDER_STATE_UNVERIFIED: { status: 502, message: 'HireFlow could not verify the current subscription state with Paddle. Reload Billing before trying again.' },
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

async function paddleRequestWithMetadata(path, options = {}, paddle = resolvePaddleConfig()) {
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

  return {
    payload,
    paddleRequestId: getPaddleRequestId(response),
  }
}

async function paddleRequest(path, options = {}, paddle = resolvePaddleConfig()) {
  const { payload } = await paddleRequestWithMetadata(path, options, paddle)
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

export function selectExactRecoveredTransaction(transactions, transactionIds, user, paddle) {
  const localIds = new Set(transactionIds.filter(Boolean))
  return transactions
    .map((transaction) => ({ transaction, capture: selectAuthoritativeCapture(transaction?.payments) }))
    .filter(({ transaction, capture }) => (
      localIds.has(transaction?.id)
      && transaction?.origin === 'subscription_recurring'
      && transaction?.status === 'completed'
      && transaction?.customer_id === user.paddle_customer_id
      && transaction?.subscription_id === user.paddle_subscription_id
      && inferPlanFromPaddlePayload(transaction, paddle) === user.subscription_plan
      && Number(transaction?.details?.totals?.grand_total ?? transaction?.details?.totals?.total ?? 0) > 0
      && capture
    ))
    .sort((left, right) => (
      new Date(right.capture.captured_at) - new Date(left.capture.captured_at)
      || String(right.transaction.id).localeCompare(String(left.transaction.id))
    ))[0]?.transaction || null
}

async function resolveExactRecoveredTransactionId(user, paddle, { pendingOnly = false } = {}) {
  const attempts = await pool.query(
    `SELECT transaction_id
     FROM payment_attempts
     WHERE user_id=$1
       AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production')=$2
       AND status IN ('pending', 'failed', 'retrying')
       AND COALESCE(
         payload->'data'->>'subscription_id', payload->'data'->>'subscriptionId',
         payload->>'subscription_id', payload->>'subscriptionId'
       )=$3
       AND transaction_id IS NOT NULL
       AND (NOT $4 OR metadata->>'resolved_by'='subscription_get_reconciliation_pending')`,
    [user.id, paddle.environment, user.paddle_subscription_id, pendingOnly],
  )
  const transactionIds = attempts.rows.map((attempt) => attempt.transaction_id)
  if (transactionIds.length === 0) return null
  try {
    const payload = await paddleRequest(
      `/transactions?subscription_id=${encodeURIComponent(user.paddle_subscription_id)}&customer_id=${encodeURIComponent(user.paddle_customer_id)}&per_page=30`,
      {},
      paddle,
    )
    return selectExactRecoveredTransaction(
      Array.isArray(payload?.data) ? payload.data : [],
      transactionIds,
      user,
      paddle,
    )?.id || null
  } catch (error) {
    console.warn('[subscriptions.current] Exact recovery transaction lookup is not available yet', {
      userId: user.id,
      paddleSubscriptionId: user.paddle_subscription_id,
      code: error.code || 'UNKNOWN',
    })
    return null
  }
}

async function resolveHeldGetRecoveryAttempts(user, paddle) {
  const transactionId = await resolveExactRecoveredTransactionId(user, paddle, { pendingOnly: true })
  if (!transactionId) return null
  await pool.query(
    `UPDATE payment_attempts
     SET status=CASE WHEN transaction_id=$4 THEN 'succeeded' ELSE status END,
         next_retry_at=NULL,
         metadata=COALESCE(metadata, '{}'::jsonb) || CASE
           WHEN transaction_id=$4 THEN $5::jsonb
           ELSE '{"resolved_by":"subscription_get_reconciliation","recovery_adjustment_ineligible":"superseded_by_exact_recovery"}'::jsonb
         END,
         updated_at=NOW()
     WHERE user_id=$1
       AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production')=$2
       AND COALESCE(
         payload->'data'->>'subscription_id', payload->'data'->>'subscriptionId',
         payload->>'subscription_id', payload->>'subscriptionId'
       )=$3
       AND metadata->>'resolved_by'='subscription_get_reconciliation_pending'`,
    [
      user.id,
      paddle.environment,
      user.paddle_subscription_id,
      transactionId,
      JSON.stringify({ resolved_by: 'subscription_get_reconciliation', transaction_id: transactionId }),
    ],
  )
  return transactionId
}

async function processRecoveredTransactionImmediately(userId, transactionId, paddle) {
  if (!transactionId || !isRecoveryBillingAdjustmentEnabled(paddle.environment)) return
  try {
    await runRecoveryBillingAdjustments({
      candidateUserId: userId,
      candidateTransactionId: transactionId,
    })
  } catch (error) {
    await logErrorToDatabase('recovery_billing_adjustment.immediate_failed', error, {
      userId,
      transactionId,
      environment: paddle.environment,
    })
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

async function logBillingErrorSafely(source, error, context) {
  try {
    await logErrorToDatabase(source, error, context)
  } catch (loggingError) {
    console.error('[subscriptions] Failed to persist safe billing error context', {
      source,
      code: error?.code || 'UNKNOWN',
      loggingCode: loggingError?.code || 'UNKNOWN',
    })
  }
}

function getScheduledChange(paddlePayload = {}) {
  const data = paddlePayload?.data || paddlePayload || {}
  return data?.scheduled_change || data?.scheduledChange || null
}

function getScheduledAction(paddlePayload = {}) {
  const scheduledChange = getScheduledChange(paddlePayload)
  return normalizeStatus(scheduledChange?.action || scheduledChange?.type || scheduledChange?.status)
}

function inspectCancellationProviderState(user, paddlePayload, paddle) {
  return inspectPaddleSubscriptionForReconciliation({
    user,
    paddlePayload,
    paddle,
  })
}

function assertCancellationEligible(inspection, paddlePayload) {
  const scheduledAction = getScheduledAction(paddlePayload)
  if (scheduledAction && !scheduledAction.includes('cancel')) {
    throw new BillingError('CANCELLATION_CHANGE_CONFLICT', { scheduledAction })
  }

  if (!inspection.ok) {
    throw new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED', {
      reason: inspection.reason,
      providerStatus: inspection.snapshot?.providerStatus || null,
    })
  }

  const providerStatus = inspection.snapshot.providerStatus
  if (['canceled', 'cancelled'].includes(providerStatus)) return 'already_ended'
  if (providerStatus === 'past_due') throw new BillingError('CANCELLATION_NOT_ALLOWED_PAST_DUE')
  if (providerStatus === 'paused') throw new BillingError('CANCELLATION_NOT_ALLOWED_PAUSED')
  if (!['active', 'trialing'].includes(providerStatus)) {
    throw new BillingError('CANCELLATION_NOT_AVAILABLE', { providerStatus })
  }

  return scheduledAction.includes('cancel') ? 'already_scheduled' : 'eligible'
}

function assertCancellationConfirmed(inspection) {
  if (!inspection.ok) {
    throw new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED', {
      reason: inspection.reason,
      providerStatus: inspection.snapshot?.providerStatus || null,
    })
  }

  const { snapshot } = inspection
  const effectiveAt = snapshot.scheduledCancellation?.effectiveAt || null
  if (
    !['active', 'trialing'].includes(snapshot.providerStatus)
    || !snapshot.scheduledCancellation
    || !effectiveAt
    || !isFutureDate(effectiveAt)
  ) {
    throw new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED', {
      reason: 'scheduled_cancellation_not_confirmed',
      providerStatus: snapshot.providerStatus,
    })
  }

  return snapshot
}

function inspectContinuationProviderState(user, paddlePayload) {
  const data = paddlePayload?.data || paddlePayload || {}
  const providerStatus = normalizeStatus(data?.status)
  const providerSubscriptionId = data?.id || null
  const providerCustomerId = data?.customer_id || data?.customer?.id || null
  const scheduledAction = getScheduledAction(paddlePayload)
  const currentPeriodEnd = dateOrNull(
    data?.current_billing_period?.ends_at || data?.billing_period?.ends_at,
  )
  const nextBillingDate = dateOrNull(data?.next_billed_at)

  const identityMatches = Boolean(
    user?.paddle_subscription_id
      && user?.paddle_customer_id
      && providerSubscriptionId === user.paddle_subscription_id
      && providerCustomerId === user.paddle_customer_id
  )
  const isContinuing = identityMatches
    && ['active', 'trialing'].includes(providerStatus)
    && !scheduledAction
    && currentPeriodEnd
    && nextBillingDate

  return {
    data,
    providerStatus,
    providerSubscriptionId,
    providerCustomerId,
    scheduledAction,
    currentPeriodEnd,
    nextBillingDate,
    identityMatches,
    isContinuing: Boolean(isContinuing),
  }
}

async function persistCancellationAudit({
  user,
  effectiveAt,
  reason,
  acceptOffer,
  paddle,
  paddleRequestId,
  providerObservedAt,
  providerAlreadyScheduled,
  reconciliationResult,
}) {
  const metadata = {
    source: 'billing_page',
    paddle_subscription_id: user.paddle_subscription_id,
    paddle_environment: paddle.environment,
    paddle_request_id: paddleRequestId,
    provider_observed_at: providerObservedAt,
    provider_schedule_already_present: providerAlreadyScheduled,
    reconciliation_result: reconciliationResult,
    effective_from: 'next_billing_period',
    acceptOffer: Boolean(acceptOffer),
  }
  const result = await pool.query(
    `WITH updated_user AS (
       UPDATE users
       SET cancellation_reason = COALESCE(NULLIF($3, ''), cancellation_reason),
           updated_at = NOW()
       WHERE id = $1
         AND paddle_subscription_id = $2
         AND cancellation_effective_at IS NOT DISTINCT FROM $4::timestamp
         AND LOWER(subscription_status) IN (
           'active', 'trialing', 'cancel_scheduled', 'cancellation_scheduled',
           'pending_cancellation', 'scheduled_cancellation'
         )
       RETURNING id
     ),
     existing_event AS (
       SELECT existing.id
       FROM subscription_change_events existing
       WHERE existing.user_id = $1
         AND existing.change_type = 'cancel'
         AND existing.effective_at IS NOT DISTINCT FROM $4::timestamp
         AND existing.metadata->>'paddle_subscription_id' = $2
       ORDER BY existing.created_at DESC, existing.id DESC
       LIMIT 1
     ),
     inserted_event AS (
       INSERT INTO subscription_change_events (
         user_id, from_plan, to_plan, change_type, effective_at, reason, metadata
       )
       SELECT $1, $5, NULL, 'cancel', $4, NULLIF($3, ''), $6::jsonb
       FROM updated_user
       WHERE NOT EXISTS (SELECT 1 FROM existing_event)
       RETURNING id
     )
     SELECT
       EXISTS (SELECT 1 FROM updated_user) AS user_persisted,
       COALESCE(
         (SELECT id FROM inserted_event LIMIT 1),
         (SELECT id FROM existing_event LIMIT 1)
       ) AS event_id`,
    [
      user.id,
      user.paddle_subscription_id,
      reason || null,
      effectiveAt,
      user.subscription_plan || 'monthly',
      JSON.stringify(metadata),
    ],
  )

  if (result.rows?.[0]?.user_persisted !== true) {
    throw new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED', {
      reason: 'local_cancellation_projection_changed',
    })
  }

  return result.rows?.[0]?.event_id || null
}

router.get('/current', requireAuth, async (req, res) => {
  try {
    console.info('[subscriptions.current] Loading subscription details', { userId: req.userId })
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_plan, subscription_renewal_date,
              next_billing_date, cancellation_effective_at, current_period_end, subscription_started_at,
              trial_ends_at, trial_consumed_at,
              payment_method_brand, payment_method_last4, paddle_customer_id, paddle_subscription_id,
              paddle_environment, last_paddle_event_at,
              latest_recovery.status AS recovery_adjustment_status,
              latest_recovery.reference AS recovery_adjustment_reference,
              EXISTS (SELECT 1 FROM payment_attempts attempt WHERE attempt.user_id = users.id) AS has_payment_attempts,
              (
                SELECT attempt.next_retry_at
                FROM payment_attempts attempt
                WHERE attempt.user_id = users.id
                  AND attempt.status IN ('failed', 'retrying')
                  AND attempt.next_retry_at IS NOT NULL
                  AND COALESCE(NULLIF(LOWER(attempt.paddle_environment), ''), 'production')
                    = COALESCE(NULLIF(LOWER(users.paddle_environment), ''), 'production')
                  AND (
                    users.paddle_subscription_id IS NULL
                    OR COALESCE(
                      attempt.payload->'data'->>'subscription_id',
                      attempt.payload->'data'->>'subscriptionId',
                      attempt.payload->>'subscription_id',
                      attempt.payload->>'subscriptionId'
                    ) = users.paddle_subscription_id
                  )
                ORDER BY attempt.updated_at DESC, attempt.id DESC
                LIMIT 1
              ) AS next_payment_retry_at
       FROM users
       LEFT JOIN LATERAL (
         SELECT recovery.status, recovery.reference
         FROM (
           SELECT adjustment.status, adjustment.id::text AS reference,
                  COALESCE(adjustment.confirmed_at, adjustment.updated_at, adjustment.created_at) AS occurred_at
           FROM recovery_billing_adjustments adjustment
           WHERE adjustment.user_id = users.id
             AND adjustment.paddle_environment = COALESCE(NULLIF(LOWER(users.paddle_environment), ''), 'production')
             AND adjustment.paddle_subscription_id = users.paddle_subscription_id
           UNION ALL
           SELECT attempt.metadata->>'recovery_adjustment_capture_status' AS status,
                  'payment_attempt:' || attempt.id::text AS reference,
                  attempt.updated_at AS occurred_at
           FROM payment_attempts attempt
           WHERE attempt.user_id = users.id
             AND attempt.metadata->>'recovery_adjustment_capture_status' IN ('retryable_failed', 'manual_required')
             AND COALESCE(attempt.metadata->>'recovery_adjustment_ineligible', '') = ''
             AND COALESCE(NULLIF(LOWER(attempt.paddle_environment), ''), 'production')
               = COALESCE(NULLIF(LOWER(users.paddle_environment), ''), 'production')
             AND COALESCE(
               attempt.payload->'data'->>'subscription_id',
               attempt.payload->'data'->>'subscriptionId',
               attempt.payload->>'subscription_id',
               attempt.payload->>'subscriptionId'
             ) = users.paddle_subscription_id
           UNION ALL
           SELECT 'superseded' AS status,
                  'payment_attempt:' || attempt.id::text AS reference,
                  attempt.updated_at AS occurred_at
           FROM payment_attempts attempt
           WHERE attempt.user_id = users.id
             AND COALESCE(attempt.metadata->>'recovery_adjustment_ineligible', '') <> ''
             AND COALESCE(NULLIF(LOWER(attempt.paddle_environment), ''), 'production')
               = COALESCE(NULLIF(LOWER(users.paddle_environment), ''), 'production')
             AND COALESCE(
               attempt.payload->'data'->>'subscription_id',
               attempt.payload->'data'->>'subscriptionId',
               attempt.payload->>'subscription_id',
               attempt.payload->>'subscriptionId'
             ) = users.paddle_subscription_id
           UNION ALL
           SELECT 'pending' AS status,
                  'payment_attempt:' || attempt.id::text AS reference,
                  attempt.updated_at AS occurred_at
           FROM payment_attempts attempt
           WHERE attempt.user_id = users.id
             AND (
               attempt.metadata->>'resolved_by' = 'subscription_get_reconciliation_pending'
               OR (
                 attempt.status = 'succeeded'
                 AND (
                   attempt.metadata->>'resolved_by' IN ('webhook', 'automatic_retry', 'admin_retry')
                   OR (
                     attempt.metadata->>'resolved_by' IN ('authoritative_reconciliation', 'subscription_get_reconciliation')
                     AND attempt.metadata->>'transaction_id' = attempt.transaction_id
                   )
                 )
               )
             )
             AND COALESCE(attempt.metadata->>'recovery_adjustment_ineligible', '') = ''
             AND COALESCE(NULLIF(LOWER(attempt.paddle_environment), ''), 'production')
               = COALESCE(NULLIF(LOWER(users.paddle_environment), ''), 'production')
             AND COALESCE(
               attempt.payload->'data'->>'subscription_id',
               attempt.payload->'data'->>'subscriptionId',
               attempt.payload->>'subscription_id',
               attempt.payload->>'subscriptionId'
             ) = users.paddle_subscription_id
             AND NOT EXISTS (
               SELECT 1 FROM recovery_billing_adjustments adjustment
               WHERE adjustment.paddle_environment
                 = COALESCE(NULLIF(LOWER(attempt.paddle_environment), ''), 'production')
                 AND adjustment.recovery_transaction_id = attempt.transaction_id
             )
         ) recovery
         ORDER BY recovery.occurred_at DESC
         LIMIT 1
       ) latest_recovery ON TRUE
       WHERE users.id = $1`,
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
    let latestSubscription = subscriptionResult.rows[0] || null

    if (!latestSubscription) {
      console.warn('[subscriptions.current] No subscription row found in subscriptions table', { userId: req.userId })
    }

    const planKey = user.subscription_plan || null
    const plan = planKey ? (PLAN_CONFIG[planKey] || PLAN_CONFIG.monthly) : null
    const hasBillingPortalAccess = Boolean(user.paddle_customer_id && user.paddle_subscription_id)
    const planCost = await resolveCurrentPlanCost(user, planKey, plan)
    const paddleDates = extractBillingDates(planCost.paddleSubscriptionPayload)
    const paddlePlan = inferPlanFromPaddlePayload(planCost.paddleSubscriptionPayload, paddle)
    const paddleStatus = normalizeStatus(paddleDates.status)
    const paddleSubscription = planCost.paddleSubscriptionPayload?.data || planCost.paddleSubscriptionPayload || {}
    const paddleCurrentPeriodEnd = paddleSubscription?.current_billing_period?.ends_at || null
    const paddleCurrentPeriodStart = paddleSubscription?.current_billing_period?.starts_at || null
    const paddleNextBillingDate = paddleSubscription?.next_billed_at || null
    const isPastDueRecovery = ['past_due', 'payment_failed'].includes(normalizeStatus(user.subscription_status))
    const hasValidPaddleDates = [paddleCurrentPeriodStart, paddleCurrentPeriodEnd, paddleNextBillingDate]
      .every((value) => value && !Number.isNaN(new Date(value).getTime()))

    if (planCost.paddleSubscriptionPayload) {
      const providerReconciliation = await reconcilePaddleSubscriptionState({
        user,
        paddlePayload: planCost.paddleSubscriptionPayload,
        paddle,
        source: 'subscriptions.current',
      })

      if (providerReconciliation.user) {
        Object.assign(user, providerReconciliation.user)
        latestSubscription = {
          ...latestSubscription,
          status: providerReconciliation.snapshot?.storedStatus || latestSubscription?.status || null,
        }
      } else if (providerReconciliation.reason === 'concurrent_state_change') {
        const latestStateResult = await pool.query(
          `SELECT subscription_status, subscription_plan, current_period_end,
                  subscription_renewal_date, next_billing_date, cancellation_effective_at,
                  paddle_customer_id, paddle_subscription_id, paddle_environment,
                  last_paddle_event_at
           FROM users
           WHERE id = $1`,
          [user.id],
        )
        if (latestStateResult.rows[0]) {
          Object.assign(user, latestStateResult.rows[0])
        }
      }
    }

    if (
      !isPastDueRecovery
      && paddleStatus === 'active'
      && normalizeStatus(user.subscription_status) === 'active'
      && !user.cancellation_effective_at
    ) {
      const heldRecoveryTransactionId = await resolveHeldGetRecoveryAttempts(user, paddle)
      await processRecoveredTransactionImmediately(user.id, heldRecoveryTransactionId, paddle)
    }

    if (
      isPastDueRecovery
      &&
      paddleSubscription.id === user.paddle_subscription_id
      && paddleSubscription.customer_id === user.paddle_customer_id
      && paddlePlan === planKey
      && paddleStatus === 'active'
      && hasValidPaddleDates
    ) {
      const exactRecoveryTransactionId = await resolveExactRecoveredTransactionId(user, paddle)
      const reconciliation = await pool.query(
        `WITH reconciled_user AS (
           UPDATE users
           SET current_period_end = $2,
               subscription_renewal_date = $2,
               next_billing_date = $3,
               subscription_status = CASE WHEN $9 THEN $6 ELSE subscription_status END,
               cancellation_effective_at = CASE WHEN $9 THEN NULL ELSE cancellation_effective_at END,
               cancellation_reason = CASE WHEN $9 THEN NULL ELSE cancellation_reason END,
               last_paddle_event_at = CASE
                 WHEN $9 THEN GREATEST(COALESCE(last_paddle_event_at, NOW()), NOW())
                 ELSE last_paddle_event_at
               END,
               updated_at = NOW()
           WHERE id = $1
             AND paddle_subscription_id = $4
             AND subscription_plan = $5
             AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $8
             AND paddle_customer_id = $13
             AND (
               NOT $9
               OR (
                 LOWER(COALESCE(subscription_status, '')) = $10
                 AND subscription_status IN ('past_due', 'payment_failed')
                 AND cancellation_effective_at IS NOT DISTINCT FROM $11::timestamp
                 AND last_paddle_event_at IS NOT DISTINCT FROM $12::timestamptz
               )
             )
           RETURNING id
         ), resolved_attempts AS (
           UPDATE payment_attempts
           SET status = CASE WHEN transaction_id=$14 THEN 'succeeded' ELSE status END,
               next_retry_at = NULL,
               updated_at = NOW(),
               metadata = COALESCE(metadata, '{}'::jsonb) || CASE
                 WHEN $14::text IS NULL
                   THEN '{"resolved_by":"subscription_get_reconciliation_pending"}'::jsonb
                 WHEN transaction_id=$14 THEN $15::jsonb
                 ELSE '{"resolved_by":"subscription_get_reconciliation","recovery_adjustment_ineligible":"superseded_by_exact_recovery"}'::jsonb
               END
           WHERE $9
             AND EXISTS (SELECT 1 FROM reconciled_user)
             AND user_id = $1
             AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $8
             AND status IN ('pending', 'failed', 'retrying')
             AND COALESCE(
               payload->'data'->>'subscription_id', payload->'data'->>'subscriptionId',
               payload->>'subscription_id', payload->>'subscriptionId'
             ) = $4
           RETURNING id
         )
         INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload, paddle_environment)
         SELECT $4, id, $6, 'subscription.reconciled', $7::jsonb, $8
         FROM reconciled_user
         ON CONFLICT (paddle_subscription_id)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           status = EXCLUDED.status,
           latest_event_type = EXCLUDED.latest_event_type,
           latest_event_payload = EXCLUDED.latest_event_payload,
           paddle_environment = EXCLUDED.paddle_environment,
           updated_at = NOW()`,
        [
          user.id,
          paddleCurrentPeriodEnd,
          paddleNextBillingDate,
          user.paddle_subscription_id,
          planKey,
          paddleStatus,
          JSON.stringify(planCost.paddleSubscriptionPayload),
          paddle.environment,
          isPastDueRecovery,
          normalizeStatus(user.subscription_status),
          user.cancellation_effective_at || null,
          user.last_paddle_event_at || null,
          user.paddle_customer_id,
          exactRecoveryTransactionId,
          JSON.stringify({
            resolved_by: 'subscription_get_reconciliation',
            transaction_id: exactRecoveryTransactionId,
          }),
        ],
      )

      if (reconciliation.rowCount > 0) {
        user.current_period_end = paddleCurrentPeriodEnd
        user.subscription_renewal_date = paddleCurrentPeriodEnd
        user.next_billing_date = paddleNextBillingDate
        if (isPastDueRecovery) {
          user.subscription_status = paddleStatus
          user.next_payment_retry_at = null
          user.cancellation_effective_at = null
          if (isRecoveryBillingAdjustmentEnabled(paddle.environment)) {
            user.recovery_adjustment_status = 'pending'
            user.recovery_adjustment_reference = exactRecoveryTransactionId
              ? `transaction:${exactRecoveryTransactionId}`
              : null
          }
          await processRecoveredTransactionImmediately(user.id, exactRecoveryTransactionId, paddle)
        }
      } else if (isPastDueRecovery) {
        const currentResult = await pool.query(
          `SELECT subscription_status, subscription_plan, paddle_subscription_id, paddle_customer_id,
                  paddle_environment, cancellation_effective_at, current_period_end,
                  subscription_renewal_date, next_billing_date, last_paddle_event_at,
                  (
                    SELECT attempt.next_retry_at
                    FROM payment_attempts attempt
                    WHERE attempt.user_id = users.id
                      AND attempt.status IN ('failed', 'retrying')
                      AND attempt.next_retry_at IS NOT NULL
                      AND COALESCE(NULLIF(LOWER(attempt.paddle_environment), ''), 'production')
                        = COALESCE(NULLIF(LOWER(users.paddle_environment), ''), 'production')
                      AND COALESCE(
                        attempt.payload->'data'->>'subscription_id',
                        attempt.payload->'data'->>'subscriptionId',
                        attempt.payload->>'subscription_id',
                        attempt.payload->>'subscriptionId'
                      ) = users.paddle_subscription_id
                    ORDER BY attempt.updated_at DESC, attempt.id DESC
                    LIMIT 1
                  ) AS next_payment_retry_at
           FROM users
           WHERE id = $1`,
          [user.id],
        )
        const current = currentResult.rows[0]
        if (current) Object.assign(user, current)
      }
    }
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
        nextBillingDate: isFinalCancellation ? null : isoOrNull(user.next_billing_date),
        nextRetryAt: ['past_due', 'payment_failed'].includes(normalizeStatus(user.subscription_status))
          ? isoOrNull(user.next_payment_retry_at)
          : null,
        recoveryAdjustmentStatus: isFinalCancellation ? null : (user.recovery_adjustment_status || null),
        recoveryAdjustmentReference: isFinalCancellation ? null : (user.recovery_adjustment_reference || null),
        recoveryAdjustmentEnabled: isRecoveryBillingAdjustmentEnabled(paddle.environment),
        cancellationEffectiveAt,
        cancelAtPeriodEnd: hasScheduledCancellation,
        paymentMethod: isFinalCancellation ? null : user.payment_method_last4
          ? `${user.payment_method_brand || 'Card'} •••• ${user.payment_method_last4}`
          : hasBillingPortalAccess ? 'Card on file' : null,
        latestRecordStatus: isFinalCancellation
          ? normalizeStatus(user.subscription_status)
          : hasScheduledCancellation
            ? (latestSubscription?.status || 'cancellation_scheduled')
            : (latestSubscription?.status || null),
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
    const recovery = await recoverFailedPaddlePlanChange({
      request: (path, options = {}) => paddleRequest(path, options, context.paddle),
      subscriptionId: context.user.paddle_subscription_id,
      metadata,
      existingCustomData: context.previousCustomData,
    })

    if (recovery.outcome !== PLAN_CHANGE_RECOVERY_OUTCOME.RECOVERED) {
      throw new PaddlePlanChangeRecoveryError(
        'No failed plan update transaction could be matched while Paddle still showed the failed plan change',
      )
    }
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
           subscription_renewal_date = COALESCE($4, subscription_renewal_date),
           next_billing_date = COALESCE($5, next_billing_date),
           updated_at = NOW()
       WHERE id = $6`,
      [visiblePlan, dates.status, dates.providerSubscriptionId, dates.currentPeriodEnd, dates.nextBillingDate, userId],
    )

    await client.query(
      `INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload, paddle_environment)
       VALUES ($1, $2, $3, 'subscription.reconciled', $4::jsonb, $5)
       ON CONFLICT (paddle_subscription_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         status = EXCLUDED.status,
         latest_event_type = EXCLUDED.latest_event_type,
         latest_event_payload = EXCLUDED.latest_event_payload,
         paddle_environment = EXCLUDED.paddle_environment,
         updated_at = NOW()`,
      [
        dates.providerSubscriptionId || context.user.paddle_subscription_id,
        userId,
        dates.status || 'active',
        JSON.stringify(paddleUpdate),
        context.paddle.environment,
      ],
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
    let paddleUpdate = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}`, {
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

    const updatePlan = inferPlanFromPaddlePayload(paddleUpdate, context.paddle)
    const updateDates = extractBillingDates(paddleUpdate)
    if (
      (context.isUpgrade && updatePlan !== targetPlan)
      || !['active', 'trialing'].includes(updateStatus)
      || !updateDates.currentPeriodEnd
      || !updateDates.nextBillingDate
    ) {
      paddleUpdate = await paddleRequest(`/subscriptions/${context.user.paddle_subscription_id}`, {}, context.paddle)
      const authoritativePlan = inferPlanFromPaddlePayload(paddleUpdate, context.paddle)
      const authoritativeStatus = normalizeStatus(paddleUpdate?.data?.status || paddleUpdate?.status)
      const authoritativeDates = extractBillingDates(paddleUpdate)

      if (
        (context.isUpgrade && authoritativePlan !== targetPlan)
        || !['active', 'trialing'].includes(authoritativeStatus)
        || !authoritativeDates.currentPeriodEnd
        || !authoritativeDates.nextBillingDate
      ) {
        throw new BillingError('PADDLE_SUBSCRIPTION_UPDATE_FAILED', { reason: 'ambiguous_plan_change_state' })
      }
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
        await logErrorToDatabase('subscriptions.change-plan.recovery_failed', recoveryError, {
          userId: req.userId,
          targetPlan,
          currentPlan,
          originalCode: error.code,
        })
        return sendBillingError(res, new BillingError('PLAN_CHANGE_RECOVERY_FAILED', { recoveryFailed: true }))
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
  let providerAccepted = false
  let providerConfirmed = false
  let providerRequestId = null
  let paddleEnvironment = null
  let providerSubscriptionId = null
  let providerStatus = null
  let effectiveAt = null
  let reconciliationResult = null

  try {
    console.info('[subscriptions.cancel] Cancel request received', {
      userId: req.userId,
      hasReason: Boolean(reason),
    })
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_plan, subscription_renewal_date,
              next_billing_date, cancellation_effective_at, current_period_end,
              paddle_customer_id, paddle_subscription_id, paddle_environment, last_paddle_event_at
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
    paddleEnvironment = paddle.environment
    providerSubscriptionId = user.paddle_subscription_id

    const currentResponse = await paddleRequestWithMetadata(
      `/subscriptions/${user.paddle_subscription_id}`,
      {},
      paddle,
    )
    providerRequestId = currentResponse.paddleRequestId
    let confirmedPayload = currentResponse.payload
    let inspection = inspectCancellationProviderState(user, confirmedPayload, paddle)
    let eligibility = assertCancellationEligible(inspection, confirmedPayload)
    providerStatus = inspection.snapshot.providerStatus

    console.info('[subscriptions.cancel] Provider state inspected', {
      userId: req.userId,
      environment: paddle.environment,
      providerSubscriptionId,
      providerStatus,
      paddleRequestId: providerRequestId,
      scheduledAction: getScheduledAction(confirmedPayload) || null,
      eligibility,
    })

    if (eligibility === 'already_ended') {
      providerConfirmed = true
      const reconciliation = await reconcilePaddleSubscriptionState({
        user,
        paddlePayload: confirmedPayload,
        paddle,
        source: 'subscription_cancel_command',
      })
      reconciliationResult = reconciliation.reason
      if (!['updated', 'already_current'].includes(reconciliation.reason)) {
        throw new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED', {
          reason: reconciliation.reason,
        })
      }

      effectiveAt = reconciliation.snapshot?.cancellationEffectiveAt || null
      console.info('[subscriptions.cancel] Subscription was already ended at Paddle', {
        userId: req.userId,
        environment: paddle.environment,
        providerSubscriptionId,
        providerStatus,
        effectiveAt,
        paddleRequestId: providerRequestId,
        reconciliationResult,
      })
      return res.json({
        status: 'ok',
        alreadyCancelled: true,
        message: 'This subscription is already cancelled.',
        effectiveAt,
      })
    }

    const providerAlreadyScheduled = eligibility === 'already_scheduled'
    if (!providerAlreadyScheduled) {
      const cancellationResponse = await paddleRequestWithMetadata(
        `/subscriptions/${user.paddle_subscription_id}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ effective_from: 'next_billing_period' }),
        },
        paddle,
      )
      providerAccepted = true
      providerRequestId = cancellationResponse.paddleRequestId
      confirmedPayload = cancellationResponse.payload
      inspection = inspectCancellationProviderState(user, confirmedPayload, paddle)

      try {
        assertCancellationConfirmed(inspection)
      } catch {
        const confirmationResponse = await paddleRequestWithMetadata(
          `/subscriptions/${user.paddle_subscription_id}`,
          {},
          paddle,
        )
        providerRequestId = confirmationResponse.paddleRequestId || providerRequestId
        confirmedPayload = confirmationResponse.payload
        inspection = inspectCancellationProviderState(user, confirmedPayload, paddle)
      }
    }

    const confirmedSnapshot = assertCancellationConfirmed(inspection)
    providerConfirmed = true
    providerStatus = confirmedSnapshot.providerStatus
    effectiveAt = confirmedSnapshot.scheduledCancellation.effectiveAt

    const reconciliation = await reconcilePaddleSubscriptionState({
      user,
      paddlePayload: confirmedPayload,
      paddle,
      source: 'subscription_cancel_command',
    })
    reconciliationResult = reconciliation.reason
    if (!['updated', 'already_current'].includes(reconciliation.reason)) {
      throw new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED', {
        reason: reconciliation.reason,
      })
    }

    const eventId = await persistCancellationAudit({
      user,
      effectiveAt,
      reason,
      acceptOffer,
      paddle,
      paddleRequestId: providerRequestId,
      providerObservedAt: confirmedSnapshot.observedAt,
      providerAlreadyScheduled,
      reconciliationResult,
    })

    console.info('[subscriptions.cancel] Cancellation confirmed', {
      userId: req.userId,
      environment: paddle.environment,
      providerSubscriptionId,
      providerStatus,
      effectiveAt,
      eventId,
      paddleRequestId: providerRequestId,
      providerAlreadyScheduled,
      reconciliationResult,
    })

    return res.json({
      status: 'ok',
      alreadyScheduled: providerAlreadyScheduled,
      message: 'Cancellation scheduled. Full access remains available through the end of the current paid period.',
      effectiveAt,
    })
  } catch (error) {
    await logBillingErrorSafely('subscriptions.cancel.failed', error, {
      userId: req.userId,
      environment: paddleEnvironment,
      providerSubscriptionId,
      providerStatus,
      effectiveAt,
      paddleRequestId: providerRequestId,
      providerAccepted,
      providerConfirmed,
      reconciliationResult,
      code: error.code || 'UNKNOWN',
      ...error.details,
    })

    if (providerConfirmed) {
      return res.status(202).json({
        status: 'syncing',
        code: 'CANCELLATION_SYNC_PENDING',
        message: 'Your cancellation is confirmed with Paddle. HireFlow is refreshing your billing status.',
        effectiveAt,
      })
    }

    if (providerAccepted) {
      return sendBillingError(res, new BillingError('CANCELLATION_PROVIDER_STATE_UNVERIFIED'))
    }

    if (error instanceof BillingError) {
      return sendBillingError(res, error)
    }

    return res.status(500).json({ error: 'Unable to cancel subscription' })
  }
})

router.post('/keep-subscription', requireAuth, async (req, res) => {
  let providerCancellationRemoved = false
  let providerContinuationConfirmed = false
  let providerRequestId = null
  let paddleEnvironment = null
  let providerSubscriptionId = null
  let providerStatus = null

  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status, subscription_plan, cancellation_effective_at,
              paddle_customer_id, paddle_subscription_id, paddle_environment
       FROM users
       WHERE id = $1`,
      [req.userId],
    )
    const user = userResult.rows[0]

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.paddle_subscription_id) return res.status(409).json({ error: BILLING_PROVIDER_MISSING_ERROR })

    const paddle = resolvePaddleConfigForUser(user)
    paddleEnvironment = paddle.environment
    providerSubscriptionId = user.paddle_subscription_id
    const currentResponse = await paddleRequestWithMetadata(
      `/subscriptions/${user.paddle_subscription_id}`,
      {},
      paddle,
    )
    providerRequestId = currentResponse.paddleRequestId
    const currentPayload = currentResponse.payload
    const current = currentPayload?.data || currentPayload || {}
    providerStatus = normalizeStatus(current.status)
    const scheduledChange = current?.scheduled_change || current?.scheduledChange || null
    const scheduledAction = normalizeStatus(scheduledChange?.action || scheduledChange?.type)

    if (providerStatus === 'canceled' || providerStatus === 'cancelled') {
      return res.status(409).json({
        code: 'SUBSCRIPTION_ALREADY_ENDED',
        error: 'This subscription has already ended. Choose a plan to subscribe again.',
        redirectTo: '/pricing?reason=subscribe_again',
      })
    }

    if (
      ['canceled', 'cancelled'].includes(normalizeStatus(user.subscription_status))
      && !isFutureDate(user.cancellation_effective_at)
    ) {
      return res.status(409).json({
        code: 'SUBSCRIPTION_ALREADY_ENDED',
        error: 'This subscription has already ended. Choose a plan to subscribe again.',
        redirectTo: '/pricing?reason=subscribe_again',
      })
    }

    const providerAlreadyContinuing = !scheduledAction.includes('cancel') && ['active', 'trialing'].includes(providerStatus)

    if (scheduledAction && !scheduledAction.includes('cancel')) {
      throw new BillingError('CANCELLATION_CHANGE_CONFLICT', { scheduledAction })
    }

    if (!scheduledAction.includes('cancel') && !providerAlreadyContinuing) {
      return res.status(409).json({
        code: 'NO_SCHEDULED_CANCELLATION',
        error: 'This subscription is not scheduled to cancel.',
      })
    }

    const localAlreadyContinuing = providerAlreadyContinuing
      && !user.cancellation_effective_at
      && ['active', 'trialing'].includes(normalizeStatus(user.subscription_status))
    if (localAlreadyContinuing) {
      const continuation = inspectContinuationProviderState(user, currentPayload)
      if (!continuation.isContinuing) {
        throw new BillingError('KEEP_SUBSCRIPTION_FAILED', {
          reason: continuation.identityMatches
            ? 'provider_continuation_dates_missing'
            : 'provider_subscription_ownership_mismatch',
        })
      }
      providerContinuationConfirmed = true
      console.info('[subscriptions.keep] Subscription was already continuing', {
        userId: req.userId,
        environment: paddle.environment,
        providerSubscriptionId,
        providerStatus,
        paddleRequestId: providerRequestId,
      })
      return res.json({
        status: 'ok',
        alreadyContinuing: true,
        message: 'Your subscription is already set to continue.',
        subscription: {
          status: providerStatus,
          cancellationEffectiveAt: null,
          nextBillingDate: continuation.nextBillingDate.toISOString(),
        },
      })
    }

    let updatedPayload = currentPayload
    if (!providerAlreadyContinuing) {
      const updateResponse = await paddleRequestWithMetadata(
        `/subscriptions/${user.paddle_subscription_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ scheduled_change: null }),
        },
        paddle,
      )
      updatedPayload = updateResponse.payload
      providerRequestId = updateResponse.paddleRequestId
      providerCancellationRemoved = true
    }

    let continuation = inspectContinuationProviderState(user, updatedPayload)
    if (!continuation.isContinuing) {
      const confirmationResponse = await paddleRequestWithMetadata(
        `/subscriptions/${user.paddle_subscription_id}`,
        {},
        paddle,
      )
      providerRequestId = confirmationResponse.paddleRequestId || providerRequestId
      updatedPayload = confirmationResponse.payload
      continuation = inspectContinuationProviderState(user, updatedPayload)
    }
    if (!continuation.isContinuing) {
      throw new BillingError('KEEP_SUBSCRIPTION_FAILED', {
        reason: continuation.identityMatches
          ? 'provider_continuation_not_confirmed'
          : 'provider_subscription_ownership_mismatch',
      })
    }

    providerContinuationConfirmed = true
    providerStatus = continuation.providerStatus
    const dates = {
      currentPeriodEnd: continuation.currentPeriodEnd.toISOString(),
      nextBillingDate: continuation.nextBillingDate.toISOString(),
    }
    const restoredStatus = continuation.providerStatus

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
          paddle_environment: paddle.environment,
          paddle_request_id: providerRequestId,
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

    console.info('[subscriptions.keep] Subscription continuation confirmed', {
      userId: req.userId,
      environment: paddle.environment,
      providerSubscriptionId,
      providerStatus,
      paddleRequestId: providerRequestId,
      providerScheduleAlreadyClear: providerAlreadyContinuing,
    })

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
    await logBillingErrorSafely('subscriptions.keep.failed', error, {
      userId: req.userId,
      environment: paddleEnvironment,
      providerSubscriptionId,
      providerStatus,
      paddleRequestId: providerRequestId,
      providerCancellationRemoved,
      providerContinuationConfirmed,
      code: error.code || 'UNKNOWN',
      ...error.details,
    })

    if (providerCancellationRemoved || providerContinuationConfirmed) {
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
