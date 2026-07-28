import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { generalApiLimiterAuth } from '../middleware/rateLimiter.js'
import { resolvePaddleConfigForUser, resolvePaddleEnvironmentForUser } from '../config/paddle.js'
import { inferPlanFromPaddlePayload } from '../services/paddlePlanChangeRecovery.js'
import { reconcilePaddleSubscriptionState } from '../services/paddleSubscriptionReconciliation.js'

const router = Router()
const TEST_MONTHLY_PLAN = 'test-monthly'
const TEST_MONTHLY_STORED_PLAN = 'monthly'
const CHECKOUT_BLOCKED_STATUSES = new Set(['active', 'trialing', 'trial', 'past_due', 'payment_failed', 'paused'])

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function isFutureDate(value, now = new Date()) {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date > now
}

function dataFromPayload(payload = {}) {
  return payload?.data || payload || {}
}

function isTerminalCancellation(user = {}, now = new Date()) {
  const status = normalizeStatus(user.subscription_status)
  return ['canceled', 'cancelled'].includes(status)
    && !isFutureDate(user.cancellation_effective_at, now)
}

function transactionBelongsToUser(transaction = {}, user = {}, paddle = {}) {
  const customData = transaction.custom_data || {}
  const transactionUserId = customData.userId ?? customData.user_id
  const environment = customData.paddleEnvironment

  return String(transactionUserId || '') === String(user.id || '')
    && environment === paddle.environment
    && (!user.paddle_customer_id || transaction.customer_id === user.paddle_customer_id)
}

function transactionMatchesPastDueLifecycle(transaction = {}, user = {}, paddle = {}) {
  return ['past_due', 'payment_failed'].includes(normalizeStatus(user.subscription_status))
    && resolvePaddleEnvironmentForUser(user) === paddle.environment
    && transaction.customer_id === user.paddle_customer_id
    && transaction.subscription_id === user.paddle_subscription_id
}

export function selectReturningCheckoutTransaction(transactions = [], user = {}, paddle = {}) {
  return transactions.find((transaction) => {
    const customData = transaction?.custom_data || {}
    return normalizeStatus(transaction?.status) === 'completed'
      && Boolean(transaction?.subscription_id)
      && customData.trialEligible === false
      && ['paid_returning', 'test'].includes(customData.checkoutMode)
      && transactionBelongsToUser(transaction, user, paddle)
  }) || null
}

async function paddleApiGet(path, paddle) {
  const response = await fetch(`${paddle.apiBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${paddle.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': paddle.apiVersion,
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error('Unable to verify the completed Paddle checkout')
    error.status = response.status
    throw error
  }

  return payload
}

async function loadCompletedCheckoutTransaction(user, paddle, transactionId = null) {
  if (transactionId) {
    const payload = await paddleApiGet(`/transactions/${encodeURIComponent(transactionId)}`, paddle)
    return dataFromPayload(payload)
  }

  if (!isTerminalCancellation(user) || !user.paddle_customer_id) {
    return null
  }

  const query = new URLSearchParams({
    customer_id: user.paddle_customer_id,
    status: 'completed',
    order_by: 'created_at[DESC]',
    per_page: '30',
  })
  const payload = await paddleApiGet(`/transactions?${query.toString()}`, paddle)
  return selectReturningCheckoutTransaction(payload?.data || [], user, paddle)
}

export async function persistVerifiedCheckoutSubscription({
  client,
  user,
  transaction,
  subscription,
  paddle,
  now = new Date(),
}) {
  const checkoutMode = transaction?.custom_data?.checkoutMode
  const isPastDueRecovery = ['past_due', 'payment_failed'].includes(normalizeStatus(user.subscription_status))
    && transaction?.subscription_id === user.paddle_subscription_id
    && transaction?.customer_id === user.paddle_customer_id
  if (
    normalizeStatus(transaction?.status) !== 'completed'
    || !transaction?.subscription_id
    || (!isPastDueRecovery && !['trial', 'paid_returning', 'test'].includes(checkoutMode))
    || transaction.subscription_id !== subscription?.id
    || (isPastDueRecovery
      ? resolvePaddleEnvironmentForUser(user) !== paddle.environment
      : !transactionBelongsToUser(transaction, user, paddle))
    || !['active', 'trialing'].includes(normalizeStatus(subscription?.status))
    || (isPastDueRecovery && normalizeStatus(subscription?.status) !== 'active')
    || subscription?.customer_id !== transaction.customer_id
  ) {
    return { synced: false, reason: 'unverified_checkout' }
  }

  const plan = inferPlanFromPaddlePayload(subscription, paddle)
  const currentPeriodEnd = subscription?.current_billing_period?.ends_at || null
  const currentPeriodStart = subscription?.current_billing_period?.starts_at || null
  const nextBillingDate = subscription?.next_billed_at || currentPeriodEnd
  const sameLifecycle = user.paddle_subscription_id === subscription.id
  const canReplaceLifecycle = isTerminalCancellation(user, now)

  const validDates = (isPastDueRecovery
    ? [currentPeriodStart, currentPeriodEnd, nextBillingDate]
    : [currentPeriodEnd, nextBillingDate])
    .every((value) => value && !Number.isNaN(new Date(value).getTime()))

  if (!plan || !validDates || (isPastDueRecovery && plan !== user.subscription_plan) || (!sameLifecycle && user.paddle_subscription_id && !canReplaceLifecycle)) {
    return { synced: false, reason: 'subscription_not_replaceable' }
  }

  try {
    await client.query('BEGIN')
    const updateResult = await client.query(
      `UPDATE users
       SET subscription_status = $2,
           subscription_plan = $3,
           paddle_subscription_id = $4,
           paddle_customer_id = $5,
           current_period_end = $6,
           subscription_renewal_date = $6,
           next_billing_date = $7,
           cancellation_effective_at = NULL,
           cancellation_reason = NULL,
           subscription_started_at = COALESCE(subscription_started_at, $8, NOW()),
           quota_anchor_at = COALESCE($8, quota_anchor_at, NOW()),
           trial_consumed_at = COALESCE(trial_consumed_at, NOW()),
           paddle_environment = $9,
           last_paddle_event_at = CASE
             WHEN $10::boolean THEN GREATEST(COALESCE(last_paddle_event_at, NOW()), NOW())
             ELSE last_paddle_event_at
           END,
           updated_at = NOW()
       WHERE id = $1
         AND (
           (
             $10::boolean
             AND LOWER(COALESCE(subscription_status, '')) = $11
             AND subscription_plan = $3
             AND paddle_subscription_id = $4
             AND paddle_customer_id = $5
             AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $9
             AND cancellation_effective_at IS NOT DISTINCT FROM $12::timestamp
             AND last_paddle_event_at IS NOT DISTINCT FROM $13::timestamptz
           )
           OR (
             NOT $10::boolean
             AND (
               paddle_subscription_id IS NULL
               OR paddle_subscription_id = $4
               OR (
                 LOWER(COALESCE(subscription_status, '')) IN ('canceled', 'cancelled')
                 AND (cancellation_effective_at IS NULL OR cancellation_effective_at <= NOW())
               )
             )
           )
         )
       RETURNING id`,
      [
        user.id,
        normalizeStatus(subscription.status),
        plan,
        subscription.id,
        transaction.customer_id,
        currentPeriodEnd,
        nextBillingDate,
        currentPeriodStart,
        paddle.environment,
        isPastDueRecovery,
        normalizeStatus(user.subscription_status),
        user.cancellation_effective_at || null,
        user.last_paddle_event_at || null,
      ],
    )

    if (updateResult.rowCount !== 1) {
      await client.query('ROLLBACK')
      const reread = await client.query(
        `SELECT subscription_status, subscription_plan, paddle_subscription_id, paddle_customer_id,
                paddle_environment, cancellation_effective_at, current_period_end, next_billing_date,
                last_paddle_event_at
         FROM users WHERE id = $1`,
        [user.id],
      )
      const stored = reread.rows[0]
      if (
        isPastDueRecovery
        && normalizeStatus(stored?.subscription_status) === 'active'
        && stored?.subscription_plan === plan
        && stored?.paddle_subscription_id === subscription.id
        && stored?.paddle_customer_id === transaction.customer_id
        && new Date(stored?.current_period_end).getTime() === new Date(currentPeriodEnd).getTime()
        && new Date(stored?.next_billing_date).getTime() === new Date(nextBillingDate).getTime()
      ) {
        return { synced: true, result: 'already_recovered', status: normalizeStatus(stored.subscription_status), plan, subscriptionId: subscription.id, transactionId: transaction.id }
      }
      const superseded = !stored
        || normalizeStatus(stored.subscription_status) !== normalizeStatus(user.subscription_status)
        || stored.subscription_plan !== user.subscription_plan
        || stored.paddle_subscription_id !== user.paddle_subscription_id
        || stored.paddle_customer_id !== user.paddle_customer_id
        || resolvePaddleEnvironmentForUser(stored) !== paddle.environment
        || String(stored.cancellation_effective_at || '') !== String(user.cancellation_effective_at || '')
        || String(stored.last_paddle_event_at || '') !== String(user.last_paddle_event_at || '')
      return { synced: false, reason: superseded ? 'recovery_superseded' : 'reconciliation_failed' }
    }

    await client.query(
      `INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload, paddle_environment)
       VALUES ($1, $2, $3, 'checkout.reconciled', $4::jsonb, $5)
       ON CONFLICT (paddle_subscription_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         status = EXCLUDED.status,
         latest_event_type = EXCLUDED.latest_event_type,
         latest_event_payload = EXCLUDED.latest_event_payload,
         paddle_environment = EXCLUDED.paddle_environment,
         updated_at = NOW()`,
      [subscription.id, user.id, normalizeStatus(subscription.status), JSON.stringify({ data: subscription }), paddle.environment],
    )
    if (isPastDueRecovery) {
      await client.query(
        `UPDATE payment_attempts
         SET status = 'succeeded', next_retry_at = NULL, updated_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
         WHERE user_id = $1
           AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $2
           AND status IN ('pending', 'failed', 'retrying')
           AND COALESCE(
             payload->'data'->>'subscription_id', payload->'data'->>'subscriptionId',
             payload->>'subscription_id', payload->>'subscriptionId'
           ) = $3`,
        [user.id, paddle.environment, subscription.id, JSON.stringify({ resolved_by: 'authoritative_reconciliation', transaction_id: transaction.id })],
      )
    }
    await client.query('COMMIT')

    return {
      synced: true,
      status: normalizeStatus(subscription.status),
      plan,
      subscriptionId: subscription.id,
      transactionId: transaction.id,
      ...(isPastDueRecovery ? { result: 'recovered' } : {}),
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

export function isTrialEligibleForUser(user = {}) {
  const status = normalizeStatus(user.subscription_status)
  const hasPreviousSubscriptionState = status && !['inactive', 'no_subscription', 'none', 'free'].includes(status)

  return !(
    hasPreviousSubscriptionState
    || user.has_payment_attempts
    || user.trial_consumed_at
    || user.trial_ends_at
    || user.subscription_started_at
    || user.paddle_subscription_id
  )
}

export function getCheckoutBlockReason(user = {}, providerSubscription = null, now = new Date()) {
  const localStatus = normalizeStatus(user.subscription_status)
  const providerStatus = normalizeStatus(providerSubscription?.status || providerSubscription?.data?.status)
  const effectiveStatus = providerStatus || localStatus
  const hasRecoverableProviderSubscription = Boolean(providerStatus || user.paddle_subscription_id)

  if (CHECKOUT_BLOCKED_STATUSES.has(effectiveStatus)) {
    const status = effectiveStatus
    if ((status === 'past_due' || status === 'payment_failed') && !hasRecoverableProviderSubscription) {
      return null
    }
    return {
      reason: status === 'past_due' || status === 'payment_failed' ? 'payment_required' : 'existing_subscription',
      redirectTo: status === 'past_due' || status === 'payment_failed' ? '/account/payment-method' : '/billing',
    }
  }

  if (isFutureDate(user.cancellation_effective_at, now)) {
    return { reason: 'cancellation_scheduled', redirectTo: '/billing' }
  }

  return null
}

function getAppOrigin(req) {
  return process.env.APP_ORIGIN || process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`
}

export function validatePaddleCheckoutPlan({ plan, testKey, paddle, trialEligible = true }) {
  if (plan !== TEST_MONTHLY_PLAN) {
    const priceId = trialEligible
      ? paddle.priceIdsByPlan[plan]
      : paddle.noTrialPriceIdsByPlan?.[plan]

    if (!trialEligible && !priceId) {
      return {
        ok: false,
        status: 503,
        error: 'Checkout for returning subscribers is not configured. Please contact support.',
      }
    }

    return {
      ok: true,
      priceId,
      storedPlan: plan,
      trialEligible,
      checkoutMode: trialEligible ? 'trial' : 'paid_returning',
    }
  }

  if (!paddle.testCheckout?.enabled || !paddle.priceIdsByPlan[TEST_MONTHLY_PLAN]) {
    return { ok: false, status: 404, error: 'Checkout is unavailable' }
  }

  if (!paddle.testCheckout.key || testKey !== paddle.testCheckout.key) {
    return { ok: false, status: 403, error: 'Checkout is unavailable' }
  }

  return { ok: true, priceId: paddle.priceIdsByPlan[TEST_MONTHLY_PLAN], storedPlan: TEST_MONTHLY_STORED_PLAN, trialEligible: false, checkoutMode: 'test' }
}

async function loadProviderSubscription(user, paddle) {
  if (!user.paddle_subscription_id) return null

  const response = await fetch(`${paddle.apiBaseUrl}/subscriptions/${user.paddle_subscription_id}`, {
    headers: {
      Authorization: `Bearer ${paddle.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': paddle.apiVersion,
    },
  })

  if (response.status === 404) return null

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error('Unable to verify the existing Paddle subscription')
    error.status = response.status
    throw error
  }

  return payload?.data || payload
}

export async function prepareCheckoutSubscriptionState({
  user,
  paddle,
  providerSubscription,
  reconcile = reconcilePaddleSubscriptionState,
}) {
  if (!providerSubscription) {
    return { user, providerSubscriptionVerified: false, reconciliationReason: 'provider_missing' }
  }

  const providerReconciliation = await reconcile({
    user,
    paddlePayload: providerSubscription,
    paddle,
    source: 'paddle.checkout_preflight',
  })

  const reconciledUser = providerReconciliation.user
    ? { ...user, ...providerReconciliation.user }
    : user

  return {
    user: reconciledUser,
    providerSubscriptionVerified: providerReconciliation.providerVerified === true,
    reconciliationReason: providerReconciliation.reason,
  }
}

async function createCheckout(req, res, logLabel) {
  const { plan, testKey } = req.body || {}

  let user

  try {
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_started_at, trial_ends_at, trial_consumed_at,
              subscription_plan, current_period_end, subscription_renewal_date, next_billing_date,
              cancellation_effective_at, paddle_customer_id, paddle_subscription_id, paddle_environment,
              last_paddle_event_at,
              EXISTS (SELECT 1 FROM payment_attempts attempt WHERE attempt.user_id = users.id) AS has_payment_attempts
       FROM users
       WHERE id = $1`,
      [req.userId],
    )
    user = userResult.rows[0]
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
    })
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  const paddle = resolvePaddleConfigForUser(user)
  console.info(`[Paddle ${logLabel}] resolved configuration`, {
    userId: user.id,
    environment: paddle.environment,
    apiBaseUrl: paddle.apiBaseUrl,
    hasApiKey: Boolean(paddle.apiKey),
    hasClientToken: Boolean(paddle.clientToken),
    hasMonthlyPriceId: Boolean(paddle.priceIdsByPlan.monthly),
    hasAnnualPriceId: Boolean(paddle.priceIdsByPlan.annual),
    testCheckoutEnabled: Boolean(paddle.testCheckout?.enabled),
  })

  if (!paddle.apiKey) {
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  if (!paddle.clientToken) {
    return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN is not configured' })
  }

  let providerSubscription = null
  let providerSubscriptionVerified = false

  try {
    providerSubscription = await loadProviderSubscription(user, paddle)
    if (providerSubscription) {
      const preflight = await prepareCheckoutSubscriptionState({
        user,
        paddle,
        providerSubscription,
      })

      if (preflight.reconciliationReason === 'concurrent_state_change') {
        return res.status(409).json({
          error: 'Your subscription changed while checkout was being prepared. Please try again.',
          code: 'subscription_sync_pending',
          redirectTo: '/pricing',
        })
      }

      providerSubscriptionVerified = preflight.providerSubscriptionVerified
      user = preflight.user

      if (!providerSubscriptionVerified) {
        return res.status(409).json({
          error: 'Checkout is unavailable until the existing Paddle subscription can be verified.',
          code: 'subscription_verification_required',
          redirectTo: '/billing',
        })
      }
    }

    const providerBlock = getCheckoutBlockReason(
      user,
      providerSubscriptionVerified ? providerSubscription : null,
    )
    if (providerBlock) {
      return res.status(409).json({
        error: 'Checkout is unavailable because a Paddle subscription still requires attention.',
        code: providerBlock.reason,
        redirectTo: providerBlock.redirectTo,
      })
    }
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to verify the existing subscription before checkout. Please try again.',
      message: error.message,
    })
  }

  const trialEligible = isTrialEligibleForUser(user)

  const planAccess = validatePaddleCheckoutPlan({ plan, testKey, paddle, trialEligible })

  if (!planAccess.ok) {
    return res.status(planAccess.status).json({ error: planAccess.error })
  }

  const priceId = planAccess.priceId
  const storedPlan = planAccess.storedPlan || plan

  if (!priceId) {
    return res.status(500).json({ error: `Paddle price ID is missing for ${plan} plan` })
  }

  try {
    const appOrigin = getAppOrigin(req)
    const successUrl = `${appOrigin}/billing/success`

    const paddleResponse = await fetch(`${paddle.apiBaseUrl}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paddle.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          price_id: priceId,
          quantity: 1,
        }],
        ...(user.paddle_customer_id
          ? { customer_id: user.paddle_customer_id }
          : { customer: { email: user.email } }),
        custom_data: {
          userId: user.id,
          email: user.email,
          plan: storedPlan,
          requestedPlan: plan,
          paddleEnvironment: paddle.environment,
          trialEligible: planAccess.trialEligible,
          checkoutMode: planAccess.checkoutMode,
        },
        return_url: successUrl,
      }),
    })

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      return res.status(502).json({
        error: 'Failed to create Paddle transaction',
        details: {
          status: paddleResponse.status,
          paddle: paddlePayload,
          environment: paddle.environment,
        },
      })
    }

    const transactionId = paddlePayload?.data?.id
    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!transactionId) {
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response' })
    }

    if (!checkoutUrl) {
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response' })
    }

    return res.json({
      checkoutUrl,
      userEmail: user.email,
      clientToken: paddle.clientToken,
      paddleEnvironment: paddle.environment,
      trialEligible: planAccess.trialEligible,
      checkoutMode: planAccess.checkoutMode,
      _version: 'WITH_USER_EMAIL_2026_03_26',
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
    })
  }
}

/**
 * POST /api/paddle/checkout
 * Create a Paddle transaction for embedded checkout
 */
router.post('/checkout', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  return createCheckout(req, res, 'checkout')
})

/**
 * POST /api/paddle/checkout-url
 * Legacy endpoint - returns same format as /checkout
 */
router.post('/checkout-url', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  return createCheckout(req, res, 'checkout-url')
})

router.post('/checkout/sync', requireAuth, generalApiLimiterAuth, async (req, res) => {
  const transactionId = typeof req.body?.transactionId === 'string' ? req.body.transactionId.trim() : null

  if (transactionId && !/^txn_[a-z0-9]+$/i.test(transactionId)) {
    return res.status(400).json({ error: 'Invalid transaction reference' })
  }

  let user

  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status, subscription_plan, cancellation_effective_at,
              paddle_customer_id, paddle_subscription_id, paddle_environment, last_paddle_event_at
       FROM users
       WHERE id = $1`,
      [req.userId],
    )
    user = userResult.rows[0]
  } catch (error) {
    console.error('[Paddle checkout] failed to load user for reconciliation', {
      userId: req.userId,
      error: error?.message || String(error),
    })
    return res.status(500).json({ error: 'Unable to verify the completed checkout yet.' })
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  if (!transactionId && !isTerminalCancellation(user)) {
    return res.json({ synced: false, reason: 'not_required' })
  }

  const paddle = resolvePaddleConfigForUser(user)
  if (!paddle.apiKey) {
    return res.status(503).json({ error: 'Billing reconciliation is not configured.' })
  }

  try {
    const transaction = await loadCompletedCheckoutTransaction(user, paddle, transactionId)

    if (!transaction) {
      return res.status(202).json({ synced: false, result: 'still_pending', reason: 'transaction_pending' })
    }

    if (!transactionBelongsToUser(transaction, user, paddle) && !transactionMatchesPastDueLifecycle(transaction, user, paddle)) {
      return res.status(404).json({ synced: false, result: 'ownership_mismatch', error: 'Completed checkout was not found' })
    }

    if (normalizeStatus(transaction.status) !== 'completed' || !transaction.subscription_id) {
      return res.status(202).json({ synced: false, result: 'not_completed', reason: 'transaction_pending' })
    }

    const subscriptionPayload = await paddleApiGet(
      `/subscriptions/${encodeURIComponent(transaction.subscription_id)}`,
      paddle,
    )
    const client = await pool.connect()

    try {
      const result = await persistVerifiedCheckoutSubscription({
        client,
        user,
        transaction,
        subscription: dataFromPayload(subscriptionPayload),
        paddle,
      })

      if (!result.synced) {
        const typedResult = result.reason === 'unverified_checkout'
          ? 'ownership_mismatch'
          : result.reason === 'recovery_superseded'
            ? 'superseded'
            : result.reason === 'reconciliation_failed'
              ? 'reconciliation_failed'
              : 'not_applicable'
        return res.status(409).json({ ...result, result: typedResult })
      }

      return res.json(result)
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('[Paddle checkout] subscription reconciliation failed', {
      userId: req.userId,
      transactionId,
      error: error?.message || String(error),
    })
    return res.status(502).json({
      error: 'We received the payment but could not verify the subscription yet. Please retry shortly.',
    })
  }
})

export default router
// Deploy: Thu Mar 26 18:22:20 UTC 2026
