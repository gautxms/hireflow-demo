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
const CHECKOUT_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000
export const CHECKOUT_CREATION_RECOVERY_GRACE_MS = 10 * 60 * 1000

const CHECKOUT_USER_SELECT = `id, email, subscription_status, subscription_started_at, trial_ends_at, trial_consumed_at,
  subscription_plan, current_period_end, subscription_renewal_date, next_billing_date,
  cancellation_effective_at, paddle_customer_id, paddle_subscription_id, paddle_environment,
  last_paddle_event_at,
  EXISTS (SELECT 1 FROM payment_attempts attempt WHERE attempt.user_id = users.id) AS has_payment_attempts`

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

    const projectionResult = await client.query(
      `INSERT INTO subscriptions (paddle_subscription_id, user_id, status, latest_event_type, latest_event_payload, paddle_environment)
       VALUES ($1, $2, $3, 'checkout.reconciled', $4::jsonb, $5)
       ON CONFLICT (paddle_environment, paddle_subscription_id)
       DO UPDATE SET
         user_id = COALESCE(subscriptions.user_id, EXCLUDED.user_id),
         status = EXCLUDED.status,
         latest_event_type = EXCLUDED.latest_event_type,
         latest_event_payload = EXCLUDED.latest_event_payload,
         paddle_environment = EXCLUDED.paddle_environment,
         updated_at = NOW()
       WHERE (subscriptions.user_id IS NULL OR subscriptions.user_id = EXCLUDED.user_id)
         AND COALESCE(NULLIF(LOWER(subscriptions.paddle_environment), ''), 'production')
             = COALESCE(NULLIF(LOWER(EXCLUDED.paddle_environment), ''), 'production')
       RETURNING id`,
      [subscription.id, user.id, normalizeStatus(subscription.status), JSON.stringify({ data: subscription }), paddle.environment],
    )
    if (projectionResult.rowCount !== 1) {
      const error = new Error('Paddle subscription projection ownership conflict')
      error.code = 'PADDLE_OWNERSHIP_CONFLICT'
      throw error
    }
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

function checkoutPurchaseMatches(reservation, purchase) {
  return reservation.requested_plan === purchase.requestedPlan
    && reservation.stored_plan === purchase.storedPlan
    && reservation.price_id === purchase.priceId
    && reservation.trial_eligible === purchase.trialEligible
    && reservation.checkout_mode === purchase.checkoutMode
    && reservation.paddle_environment === purchase.environment
}

function reservationAgeMs(reservation, now = new Date()) {
  const createdAt = new Date(reservation?.created_at)
  if (Number.isNaN(createdAt.getTime())) return Number.POSITIVE_INFINITY
  return Math.max(0, now.getTime() - createdAt.getTime())
}

export async function acquireCheckoutReservation({
  db = pool,
  userId,
  paddle,
  plan,
  testKey,
  now = new Date(),
}) {
  const client = await db.connect()

  try {
    await client.query('BEGIN')
    const userResult = await client.query(
      `SELECT ${CHECKOUT_USER_SELECT}
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId],
    )
    const user = userResult.rows[0]

    if (!user) {
      await client.query('ROLLBACK')
      return { action: 'user_not_found' }
    }

    if (resolvePaddleEnvironmentForUser(user) !== paddle.environment) {
      await client.query('ROLLBACK')
      return { action: 'environment_changed' }
    }

    const block = getCheckoutBlockReason(user)
    if (block) {
      await client.query('ROLLBACK')
      return { action: 'blocked', block, user }
    }

    const trialEligible = isTrialEligibleForUser(user)
    const planAccess = validatePaddleCheckoutPlan({ plan, testKey, paddle, trialEligible })
    if (!planAccess.ok) {
      await client.query('ROLLBACK')
      return { action: 'invalid_plan', planAccess, user }
    }

    const purchase = {
      requestedPlan: plan,
      storedPlan: planAccess.storedPlan || plan,
      priceId: planAccess.priceId,
      trialEligible: planAccess.trialEligible,
      checkoutMode: planAccess.checkoutMode,
      environment: paddle.environment,
    }

    if (!purchase.priceId) {
      await client.query('ROLLBACK')
      return { action: 'price_missing', purchase, user }
    }

    const existingResult = await client.query(
      `SELECT id, reservation_token, user_id, paddle_environment, requested_plan, stored_plan,
              price_id, trial_eligible, checkout_mode, status, paddle_transaction_id,
              paddle_customer_id, checkout_url, provider_status, failure_code,
              expires_at, created_at, updated_at
       FROM paddle_checkout_reservations
       WHERE user_id = $1
         AND paddle_environment = $2
         AND status IN ('creating', 'ready')
       LIMIT 1
       FOR UPDATE`,
      [user.id, paddle.environment],
    )
    const existing = existingResult.rows[0]

    if (existing) {
      await client.query('COMMIT')
      if (!checkoutPurchaseMatches(existing, purchase)) {
        return { action: 'purchase_conflict', reservation: existing, purchase, user }
      }
      if (existing.status === 'ready') {
        return { action: 'reuse', reservation: existing, purchase, user }
      }
      return {
        action: reservationAgeMs(existing, now) >= CHECKOUT_CREATION_RECOVERY_GRACE_MS
          ? 'recover'
          : 'in_progress',
        reservation: existing,
        purchase,
        user,
      }
    }

    const expiresAt = new Date(now.getTime() + CHECKOUT_RESERVATION_TTL_MS).toISOString()
    const inserted = await client.query(
      `INSERT INTO paddle_checkout_reservations (
         user_id, paddle_environment, requested_plan, stored_plan, price_id,
         trial_eligible, checkout_mode, status, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'creating', $8::timestamptz)
       RETURNING id, reservation_token, user_id, paddle_environment, requested_plan, stored_plan,
                 price_id, trial_eligible, checkout_mode, status, paddle_transaction_id,
                 paddle_customer_id, checkout_url, provider_status, failure_code,
                 expires_at, created_at, updated_at`,
      [
        user.id,
        paddle.environment,
        purchase.requestedPlan,
        purchase.storedPlan,
        purchase.priceId,
        purchase.trialEligible,
        purchase.checkoutMode,
        expiresAt,
      ],
    )
    await client.query('COMMIT')
    return { action: 'create', reservation: inserted.rows[0], purchase, user }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function storeCheckoutReservationResult({
  db = pool,
  reservation,
  transaction,
}) {
  const transactionId = transaction?.id || null
  const checkoutUrl = transaction?.checkout?.url || null

  if (!transactionId || !checkoutUrl) {
    return { stored: false, reason: 'provider_result_incomplete' }
  }

  const result = await db.query(
    `UPDATE paddle_checkout_reservations
     SET status = 'ready',
         paddle_transaction_id = $3,
         paddle_customer_id = $4,
         checkout_url = $5,
         provider_status = $6,
         failure_code = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND reservation_token = $2
       AND status = 'creating'
     RETURNING *`,
    [
      reservation.id,
      reservation.reservation_token,
      transactionId,
      transaction.customer_id || null,
      checkoutUrl,
      normalizeStatus(transaction.status),
    ],
  )

  if (result.rowCount === 1) return { stored: true, reservation: result.rows[0] }

  const current = await db.query(
    `SELECT * FROM paddle_checkout_reservations
     WHERE id = $1 AND reservation_token = $2`,
    [reservation.id, reservation.reservation_token],
  )
  return { stored: false, reason: 'reservation_superseded', reservation: current.rows[0] || null }
}

export async function updateCheckoutReservationStatus({
  db = pool,
  reservation,
  status,
  failureCode = null,
  providerStatus = null,
  transaction = null,
}) {
  if (!['completed', 'failed', 'conflict'].includes(status)) {
    throw new Error('Invalid checkout reservation terminal status')
  }

  return db.query(
    `UPDATE paddle_checkout_reservations
     SET status = $3,
         paddle_transaction_id = COALESCE($4, paddle_transaction_id),
         paddle_customer_id = COALESCE($5, paddle_customer_id),
         checkout_url = NULL,
         provider_status = COALESCE($6, provider_status),
         failure_code = $7,
         updated_at = NOW()
     WHERE id = $1
       AND reservation_token = $2
       AND status IN ('creating', 'ready')
     RETURNING *`,
    [
      reservation.id,
      reservation.reservation_token,
      status,
      transaction?.id || null,
      transaction?.customer_id || null,
      providerStatus || normalizeStatus(transaction?.status) || null,
      failureCode,
    ],
  )
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

function transactionPriceIds(transaction = {}) {
  return (transaction.items || [])
    .map((item) => item?.price_id || item?.price?.id)
    .filter(Boolean)
}

export function transactionMatchesCheckoutReservation(transaction = {}, reservation = {}, user = {}) {
  const customData = transaction.custom_data || {}
  const transactionUserId = customData.userId ?? customData.user_id
  const reservationToken = customData.checkoutReservationId ?? customData.checkout_reservation_id

  return String(transactionUserId || '') === String(user.id || '')
    && String(reservationToken || '') === String(reservation.reservation_token || '')
    && customData.paddleEnvironment === reservation.paddle_environment
    && customData.requestedPlan === reservation.requested_plan
    && customData.plan === reservation.stored_plan
    && customData.checkoutMode === reservation.checkout_mode
    && customData.trialEligible === reservation.trial_eligible
    && transactionPriceIds(transaction).includes(reservation.price_id)
    && (!user.paddle_customer_id || transaction.customer_id === user.paddle_customer_id)
}

function isReusableCheckoutTransaction(transaction = {}) {
  return ['draft', 'ready'].includes(normalizeStatus(transaction.status))
    && !transaction.subscription_id
    && Boolean(transaction?.checkout?.url)
}

async function loadPaddleTransaction(transactionId, paddle) {
  const payload = await paddleApiGet(`/transactions/${encodeURIComponent(transactionId)}`, paddle)
  return dataFromPayload(payload)
}

async function findReservationTransactions(reservation, user, paddle) {
  const customerIds = new Set([
    reservation.paddle_customer_id,
    user.paddle_customer_id,
  ].filter(Boolean))

  if (customerIds.size === 0 && user.email) {
    const customerQuery = new URLSearchParams({
      email: user.email,
      status: 'active',
      per_page: '200',
    })
    const customerPayload = await paddleApiGet(`/customers?${customerQuery.toString()}`, paddle)
    for (const customer of customerPayload?.data || []) {
      if (customer?.id) customerIds.add(customer.id)
      if (customerIds.size >= 10) break
    }
  }

  const matches = []
  for (const customerId of customerIds) {
    const transactionQuery = new URLSearchParams({
      customer_id: customerId,
      origin: 'api',
      order_by: 'created_at[DESC]',
      per_page: '30',
    })
    const payload = await paddleApiGet(`/transactions?${transactionQuery.toString()}`, paddle)
    for (const transaction of payload?.data || []) {
      if (transactionMatchesCheckoutReservation(transaction, reservation, user)) {
        matches.push(transaction)
      }
    }
  }

  return matches.filter((transaction, index, all) => (
    all.findIndex((candidate) => candidate.id === transaction.id) === index
  ))
}

async function resolveReservedCheckout({ acquisition, paddle }) {
  const { reservation, user } = acquisition
  let transaction = null

  try {
    if (reservation.paddle_transaction_id) {
      transaction = await loadPaddleTransaction(reservation.paddle_transaction_id, paddle)
    } else {
      const matches = await findReservationTransactions(reservation, user, paddle)
      if (matches.length > 1) {
        await updateCheckoutReservationStatus({
          reservation,
          status: 'conflict',
          failureCode: 'multiple_provider_transactions',
        })
        console.error('[Paddle checkout] checkout ownership conflict rejected', {
          userId: user.id,
          environment: paddle.environment,
          reservationId: reservation.id,
          transactionCount: matches.length,
        })
        return { action: 'conflict' }
      }
      transaction = matches[0] || null
    }
  } catch (error) {
    if (error.status === 404 && reservation.paddle_transaction_id) {
      await updateCheckoutReservationStatus({
        reservation,
        status: 'failed',
        failureCode: 'provider_transaction_missing',
        providerStatus: 'missing',
      })
      return { action: 'retry' }
    }
    throw error
  }

  if (!transaction) {
    await updateCheckoutReservationStatus({
      reservation,
      status: 'failed',
      failureCode: 'stale_creation_without_provider_transaction',
      providerStatus: 'missing',
    })
    console.warn('[Paddle checkout] stale reservation recovered without a provider transaction', {
      userId: user.id,
      environment: paddle.environment,
      reservationId: reservation.id,
    })
    return { action: 'retry' }
  }

  if (!transactionMatchesCheckoutReservation(transaction, reservation, user)) {
    await updateCheckoutReservationStatus({
      reservation,
      status: 'conflict',
      failureCode: 'provider_transaction_mismatch',
      transaction,
    })
    console.error('[Paddle checkout] provider transaction mismatch rejected', {
      userId: user.id,
      environment: paddle.environment,
      reservationId: reservation.id,
      transactionId: transaction.id || null,
      customerId: transaction.customer_id || null,
    })
    return { action: 'conflict' }
  }

  if (isReusableCheckoutTransaction(transaction)) {
    if (reservation.status === 'creating') {
      await storeCheckoutReservationResult({ reservation, transaction })
    }
    console.info('[Paddle checkout] existing checkout reused', {
      userId: user.id,
      environment: paddle.environment,
      reservationId: reservation.id,
      transactionId: transaction.id,
    })
    return { action: 'reuse', transaction }
  }

  const status = normalizeStatus(transaction.status)
  if (['paid', 'completed'].includes(status) || transaction.subscription_id) {
    await updateCheckoutReservationStatus({ reservation, status: 'completed', transaction })
    return { action: 'completed', transaction }
  }

  if (['canceled', 'cancelled', 'past_due'].includes(status)) {
    await updateCheckoutReservationStatus({
      reservation,
      status: 'failed',
      failureCode: `provider_${status}`,
      transaction,
    })
    return { action: 'retry' }
  }

  return { action: 'in_progress' }
}

function checkoutResponse({ transaction, user, paddle, purchase }) {
  return {
    checkoutUrl: transaction.checkout.url,
    transactionId: transaction.id,
    userEmail: user.email,
    clientToken: paddle.clientToken,
    paddleEnvironment: paddle.environment,
    trialEligible: purchase.trialEligible,
    checkoutMode: purchase.checkoutMode,
    _version: 'WITH_USER_EMAIL_2026_03_26',
  }
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

export async function createCheckout(req, res, logLabel = 'checkout') {
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
    console.error(`[Paddle ${logLabel}] failed to load checkout account`, {
      userId: req.userId,
      error: error?.code || error?.name || 'unknown_error',
    })
    return res.status(500).json({
      error: 'Failed to create checkout',
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
    console.error(`[Paddle ${logLabel}] existing subscription verification failed`, {
      userId: user.id,
      environment: paddle.environment,
      providerStatusCode: error?.status || null,
    })
    return res.status(502).json({
      error: 'Unable to verify the existing subscription before checkout. Please try again.',
    })
  }

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const acquisition = await acquireCheckoutReservation({
        userId: user.id,
        paddle,
        plan,
        testKey,
      })

      if (acquisition.action === 'user_not_found') {
        return res.status(404).json({ error: 'User not found' })
      }
      if (acquisition.action === 'environment_changed') {
        return res.status(409).json({
          error: 'Checkout environment changed while the request was being prepared. Please retry.',
          code: 'checkout_environment_changed',
        })
      }
      if (acquisition.action === 'blocked') {
        return res.status(409).json({
          error: 'Checkout is unavailable because a Paddle subscription still requires attention.',
          code: acquisition.block.reason,
          redirectTo: acquisition.block.redirectTo,
        })
      }
      if (acquisition.action === 'invalid_plan') {
        return res.status(acquisition.planAccess.status).json({ error: acquisition.planAccess.error })
      }
      if (acquisition.action === 'price_missing') {
        return res.status(500).json({ error: `Paddle price ID is missing for ${plan} plan` })
      }
      if (acquisition.action === 'purchase_conflict') {
        console.warn('[Paddle checkout] duplicate request prevented for a different purchase', {
          userId: acquisition.user.id,
          environment: paddle.environment,
          reservationId: acquisition.reservation.id,
          requestedPlan: acquisition.purchase.requestedPlan,
        })
        return res.status(409).json({
          error: 'A different checkout is already in progress. Complete or close it before changing plans.',
          code: 'checkout_purchase_conflict',
        })
      }
      if (acquisition.action === 'in_progress') {
        console.info('[Paddle checkout] duplicate request prevented while checkout creation is in progress', {
          userId: acquisition.user.id,
          environment: paddle.environment,
          reservationId: acquisition.reservation.id,
        })
        return res.status(409).json({
          error: 'Checkout is already being prepared. Please retry shortly.',
          code: 'checkout_in_progress',
        })
      }
      if (acquisition.action === 'reuse' || acquisition.action === 'recover') {
        const resolved = await resolveReservedCheckout({ acquisition, paddle })
        if (resolved.action === 'reuse') {
          return res.json(checkoutResponse({
            transaction: resolved.transaction,
            user: acquisition.user,
            paddle,
            purchase: acquisition.purchase,
          }))
        }
        if (resolved.action === 'completed') {
          return res.status(409).json({
            error: 'This checkout has already completed. Subscription confirmation is in progress.',
            code: 'checkout_completed',
            redirectTo: '/billing/success',
          })
        }
        if (resolved.action === 'conflict') {
          return res.status(409).json({
            error: 'Checkout ownership could not be verified. Please contact support.',
            code: 'checkout_ownership_conflict',
          })
        }
        if (resolved.action === 'in_progress') {
          return res.status(409).json({
            error: 'Checkout is still being prepared. Please retry shortly.',
            code: 'checkout_in_progress',
          })
        }
        if (resolved.action === 'retry') continue
      }

      if (acquisition.action !== 'create') {
        return res.status(409).json({ error: 'Checkout could not be prepared safely. Please retry.' })
      }

      const appOrigin = getAppOrigin(req)
      const successUrl = `${appOrigin}/billing/success`
      let paddleResponse
      let paddlePayload

      try {
        paddleResponse = await fetch(`${paddle.apiBaseUrl}/transactions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paddle.apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': paddle.apiVersion,
          },
          body: JSON.stringify({
            items: [{
              price_id: acquisition.purchase.priceId,
              quantity: 1,
            }],
            ...(acquisition.user.paddle_customer_id
              ? { customer_id: acquisition.user.paddle_customer_id }
              : { customer: { email: acquisition.user.email } }),
            custom_data: {
              userId: acquisition.user.id,
              email: acquisition.user.email,
              plan: acquisition.purchase.storedPlan,
              requestedPlan: acquisition.purchase.requestedPlan,
              paddleEnvironment: paddle.environment,
              trialEligible: acquisition.purchase.trialEligible,
              checkoutMode: acquisition.purchase.checkoutMode,
              checkoutReservationId: acquisition.reservation.reservation_token,
            },
            return_url: successUrl,
          }),
        })
        paddlePayload = await paddleResponse.json().catch(() => ({}))
      } catch (error) {
        console.error('[Paddle checkout] provider transaction creation outcome is unknown', {
          userId: acquisition.user.id,
          environment: paddle.environment,
          reservationId: acquisition.reservation.id,
          error: error?.message || String(error),
        })
        return res.status(502).json({
          error: 'Paddle checkout could not be confirmed. Please retry shortly.',
          code: 'checkout_provider_outcome_unknown',
        })
      }

      if (!paddleResponse.ok) {
        if (paddleResponse.status >= 400 && paddleResponse.status < 500) {
          await updateCheckoutReservationStatus({
            reservation: acquisition.reservation,
            status: 'failed',
            failureCode: `provider_rejected_${paddleResponse.status}`,
          })
        }
        console.error('[Paddle checkout] provider transaction creation failed', {
          userId: acquisition.user.id,
          environment: paddle.environment,
          reservationId: acquisition.reservation.id,
          providerStatusCode: paddleResponse.status,
          providerRequestId: paddlePayload?.meta?.request_id || null,
        })
        return res.status(502).json({ error: 'Failed to create Paddle transaction' })
      }

      const transaction = dataFromPayload(paddlePayload)
      if (!transactionMatchesCheckoutReservation(transaction, acquisition.reservation, acquisition.user)) {
        await updateCheckoutReservationStatus({
          reservation: acquisition.reservation,
          status: 'conflict',
          failureCode: 'created_transaction_mismatch',
          transaction,
        })
        return res.status(502).json({ error: 'Paddle checkout ownership could not be verified' })
      }

      if (!isReusableCheckoutTransaction(transaction)) {
        return res.status(502).json({ error: 'Paddle checkout was not ready for use' })
      }

      const stored = await storeCheckoutReservationResult({
        reservation: acquisition.reservation,
        transaction,
      })
      if (!stored.stored) {
        return res.status(409).json({
          error: 'Checkout state changed while the transaction was being prepared.',
          code: 'checkout_state_changed',
          redirectTo: stored.reservation?.status === 'completed' ? '/billing/success' : undefined,
        })
      }

      console.info('[Paddle checkout] checkout reservation created', {
        userId: acquisition.user.id,
        environment: paddle.environment,
        reservationId: acquisition.reservation.id,
        transactionId: transaction.id,
      })
      return res.json(checkoutResponse({
        transaction,
        user: acquisition.user,
        paddle,
        purchase: acquisition.purchase,
      }))
    }

    return res.status(409).json({
      error: 'Checkout could not be prepared safely. Please retry.',
      code: 'checkout_retry_required',
    })
  } catch (error) {
    console.error(`[Paddle ${logLabel}] checkout preparation failed`, {
      userId: user.id,
      environment: paddle.environment,
      error: error?.code || error?.name || 'unknown_error',
    })
    return res.status(500).json({
      error: 'Failed to create checkout',
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
