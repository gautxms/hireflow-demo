import { pool } from '../db/client.js'
import { resolvePaddleEnvironmentForUser } from '../config/paddle.js'
import { inferPlanFromPaddlePayload } from './paddlePlanChangeRecovery.js'
import { normalizePaddleTimestamp } from '../utils/paddleTimestamps.js'

const SUPPORTED_PROVIDER_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'paused',
  'canceled',
  'cancelled',
])

const RECOVERY_STATUSES = new Set(['past_due', 'payment_failed'])
const TERMINAL_STATUSES = new Set(['canceled', 'cancelled'])

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function dataFromPayload(payload = {}) {
  return payload?.data || payload || {}
}

function validIsoOrNull(value) {
  return normalizePaddleTimestamp(value)
}

function sameInstant(left, right) {
  return validIsoOrNull(left) === validIsoOrNull(right)
}

function isFutureInstant(value, now = new Date()) {
  const iso = validIsoOrNull(value)
  return Boolean(iso && new Date(iso).getTime() > now.getTime())
}

function getScheduledCancellation(subscription = {}) {
  const scheduledChange = subscription?.scheduled_change || subscription?.scheduledChange || null
  const action = normalizeStatus(scheduledChange?.action || scheduledChange?.type || scheduledChange?.status)

  if (!action.includes('cancel')) return null

  return {
    effectiveAt: validIsoOrNull(scheduledChange?.effective_at || scheduledChange?.effectiveAt),
  }
}

function providerObservedAt(subscription = {}) {
  return validIsoOrNull(
    subscription?.updated_at
      || subscription?.updatedAt
      || subscription?.canceled_at
      || subscription?.cancelled_at,
  )
}

function cancellationEffectiveAt(subscription, snapshot, user) {
  if (snapshot.isTerminal) {
    return validIsoOrNull(
      subscription?.canceled_at
        || subscription?.cancelled_at
        || subscription?.current_billing_period?.ends_at
        || user?.cancellation_effective_at
        || snapshot.observedAt,
    )
  }

  if (snapshot.scheduledCancellation) {
    return snapshot.scheduledCancellation.effectiveAt
      || snapshot.currentPeriodEnd
      || validIsoOrNull(user?.cancellation_effective_at)
  }

  return null
}

export function inspectPaddleSubscriptionForReconciliation({
  user,
  paddlePayload,
  paddle,
  pendingProviderPlan = null,
  allowProviderConfirmedRecovery = false,
}) {
  const subscription = dataFromPayload(paddlePayload)
  const providerStatus = normalizeStatus(subscription?.status)
  const storedStatus = providerStatus === 'canceled' ? 'cancelled' : providerStatus
  const observedAt = providerObservedAt(subscription)
  const scheduledCancellation = getScheduledCancellation(subscription)
  const currentPeriodEnd = validIsoOrNull(
    subscription?.current_billing_period?.ends_at
      || subscription?.billing_period?.ends_at,
  )
  const nextBillingDate = validIsoOrNull(subscription?.next_billed_at)
  const isTerminal = TERMINAL_STATUSES.has(providerStatus)
  const observedProviderPlan = inferPlanFromPaddlePayload(subscription, paddle)
  const providerPlan = observedProviderPlan === pendingProviderPlan
    ? user?.subscription_plan
    : observedProviderPlan
  const environment = resolvePaddleEnvironmentForUser(user)

  const snapshot = {
    providerSubscriptionId: subscription?.id || null,
    providerCustomerId: subscription?.customer_id || subscription?.customer?.id || null,
    providerStatus,
    storedStatus,
    providerPlan,
    observedProviderPlan,
    currentPeriodEnd,
    nextBillingDate,
    observedAt,
    scheduledCancellation,
    isTerminal,
  }

  if (!SUPPORTED_PROVIDER_STATUSES.has(providerStatus)) {
    return { ok: false, reason: 'unsupported_provider_status', snapshot }
  }

  if (!paddle?.environment || environment !== paddle.environment) {
    return { ok: false, reason: 'environment_mismatch', snapshot }
  }

  if (
    !user?.paddle_subscription_id
    || snapshot.providerSubscriptionId !== user.paddle_subscription_id
  ) {
    return { ok: false, reason: 'subscription_ownership_mismatch', snapshot }
  }

  if (
    !user?.paddle_customer_id
    || !snapshot.providerCustomerId
    || snapshot.providerCustomerId !== user.paddle_customer_id
  ) {
    return { ok: false, reason: 'customer_ownership_mismatch', snapshot }
  }

  if (!observedAt) {
    return { ok: false, reason: 'provider_timestamp_missing', snapshot }
  }

  const lastPaddleEventAt = validIsoOrNull(user?.last_paddle_event_at)
  if (
    lastPaddleEventAt
    && new Date(observedAt).getTime() < new Date(lastPaddleEventAt).getTime()
  ) {
    return { ok: false, reason: 'stale_provider_snapshot', snapshot }
  }

  if (!isTerminal && (!providerPlan || providerPlan !== user.subscription_plan)) {
    return { ok: false, reason: 'plan_mismatch', snapshot }
  }

  if (['active', 'trialing'].includes(providerStatus)) {
    if (!currentPeriodEnd) {
      return { ok: false, reason: 'current_period_missing', snapshot }
    }
    if (!scheduledCancellation && !nextBillingDate) {
      return { ok: false, reason: 'next_billing_date_missing', snapshot }
    }
  }

  if (
    RECOVERY_STATUSES.has(normalizeStatus(user.subscription_status))
    && providerStatus === 'active'
    && !allowProviderConfirmedRecovery
  ) {
    return {
      ok: false,
      providerVerified: true,
      reason: 'recovery_confirmation_required',
      snapshot,
    }
  }

  if (
    TERMINAL_STATUSES.has(normalizeStatus(user.subscription_status))
    && !isFutureInstant(user.cancellation_effective_at)
    && ['active', 'trialing'].includes(providerStatus)
  ) {
    return {
      ok: false,
      providerVerified: true,
      reason: 'terminal_lifecycle_cannot_reactivate',
      snapshot,
    }
  }

  snapshot.cancellationEffectiveAt = cancellationEffectiveAt(subscription, snapshot, user)
  return { ok: true, providerVerified: true, snapshot }
}

function hasMaterialDifference(user, snapshot) {
  return normalizeStatus(user.subscription_status) !== snapshot.storedStatus
    || !sameInstant(user.current_period_end, snapshot.currentPeriodEnd)
    || !sameInstant(
      user.subscription_renewal_date,
      snapshot.isTerminal ? null : snapshot.currentPeriodEnd,
    )
    || !sameInstant(user.next_billing_date, snapshot.nextBillingDate)
    || !sameInstant(user.cancellation_effective_at, snapshot.cancellationEffectiveAt)
    || user.subscription_plan !== (snapshot.providerPlan || user.subscription_plan)
    || !sameInstant(user.last_paddle_event_at, snapshot.observedAt)
}

function reconciledUserProjection(user, snapshot) {
  return {
    ...user,
    subscription_status: snapshot.storedStatus,
    subscription_plan: snapshot.providerPlan || user.subscription_plan,
    current_period_end: snapshot.currentPeriodEnd || (snapshot.isTerminal ? user.current_period_end : null),
    subscription_renewal_date: snapshot.isTerminal ? null : snapshot.currentPeriodEnd,
    next_billing_date: snapshot.nextBillingDate,
    cancellation_effective_at: snapshot.cancellationEffectiveAt,
    next_payment_retry_at: snapshot.isTerminal ? null : user.next_payment_retry_at,
    last_paddle_event_at: snapshot.observedAt,
  }
}

export async function reconcilePaddleSubscriptionState({
  user,
  paddlePayload,
  paddle,
  pendingProviderPlan = null,
  allowProviderConfirmedRecovery = false,
  db = pool,
  source = 'subscription_get',
}) {
  const inspection = inspectPaddleSubscriptionForReconciliation({
    user,
    paddlePayload,
    paddle,
    pendingProviderPlan,
    allowProviderConfirmedRecovery,
  })

  if (!inspection.ok) {
    if (!['recovery_confirmation_required', 'terminal_lifecycle_cannot_reactivate'].includes(inspection.reason)) {
      console.warn('[Paddle subscription reconciliation] Provider state was not applied', {
        userId: user?.id || null,
        environment: paddle?.environment || null,
        localCustomerId: user?.paddle_customer_id || null,
        localSubscriptionId: user?.paddle_subscription_id || null,
        providerCustomerId: inspection.snapshot?.providerCustomerId || null,
        providerSubscriptionId: inspection.snapshot?.providerSubscriptionId || null,
        previousStatus: user?.subscription_status || null,
        providerStatus: inspection.snapshot?.providerStatus || null,
        resultingStatus: user?.subscription_status || null,
        result: inspection.reason,
        stateChanged: false,
        source,
      })
    }
    return {
      reconciled: false,
      providerVerified: inspection.providerVerified === true,
      reason: inspection.reason,
      snapshot: inspection.snapshot,
    }
  }

  const { snapshot } = inspection
  const nextUser = reconciledUserProjection(user, snapshot)

  // A terminal snapshot also authoritatively suppresses any pending payment retries.
  // That cleanup lives outside the users row, so it must still run when the user
  // projection already matches Paddle (for example, after a cancellation webhook).
  if (!hasMaterialDifference(user, snapshot) && !snapshot.isTerminal) {
    return {
      reconciled: false,
      providerVerified: true,
      reason: 'already_current',
      snapshot,
      user: nextUser,
    }
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const updateResult = await client.query(
      `UPDATE users
       SET subscription_status = $2,
           subscription_plan = COALESCE($3, subscription_plan),
           current_period_end = CASE
             WHEN $4::boolean THEN COALESCE($5::timestamp, current_period_end)
             ELSE $5::timestamp
           END,
           subscription_renewal_date = CASE WHEN $4::boolean THEN NULL ELSE $5::timestamp END,
           next_billing_date = $6::timestamp,
           cancellation_effective_at = $7::timestamp,
           cancellation_reason = CASE
             WHEN $7::timestamp IS NULL AND NOT $4::boolean THEN NULL
             ELSE cancellation_reason
           END,
           last_paddle_event_at = GREATEST(
             COALESCE(last_paddle_event_at, $8::timestamptz),
             $8::timestamptz
           ),
           updated_at = NOW()
       WHERE id = $1
         AND paddle_subscription_id = $9
         AND paddle_customer_id = $10
         AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $11
         AND subscription_status IS NOT DISTINCT FROM $12
         AND cancellation_effective_at IS NOT DISTINCT FROM $13::timestamp
         AND last_paddle_event_at IS NOT DISTINCT FROM $14::timestamptz
         AND (
           last_paddle_event_at IS NULL
           OR $8::timestamptz >= last_paddle_event_at
         )
       RETURNING id`,
      [
        user.id,
        snapshot.storedStatus,
        snapshot.providerPlan,
        snapshot.isTerminal,
        snapshot.currentPeriodEnd,
        snapshot.nextBillingDate,
        snapshot.cancellationEffectiveAt,
        snapshot.observedAt,
        snapshot.providerSubscriptionId,
        snapshot.providerCustomerId,
        paddle.environment,
        user.subscription_status ?? null,
        user.cancellation_effective_at || null,
        user.last_paddle_event_at || null,
      ],
    )

    if (updateResult.rowCount !== 1) {
      await client.query('ROLLBACK')
      console.warn('[Paddle subscription reconciliation] Concurrent local state change won reconciliation race', {
        userId: user.id,
        environment: paddle.environment,
        providerCustomerId: snapshot.providerCustomerId,
        providerSubscriptionId: snapshot.providerSubscriptionId,
        previousStatus: user.subscription_status || null,
        providerStatus: snapshot.providerStatus,
        resultingStatus: user.subscription_status || null,
        result: 'concurrent_state_change',
        stateChanged: false,
        source,
      })
      return {
        reconciled: false,
        providerVerified: true,
        reason: 'concurrent_state_change',
        snapshot,
      }
    }

    if (snapshot.isTerminal) {
      await client.query(
        `UPDATE payment_attempts
         SET next_retry_at = NULL,
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = NOW()
         WHERE user_id = $1
           AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $2
           AND (
             COALESCE(
               payload->'data'->>'subscription_id', payload->'data'->>'subscriptionId',
               payload->>'subscription_id', payload->>'subscriptionId'
             ) = $3
             OR (
               COALESCE(
                 payload->'data'->>'subscription_id', payload->'data'->>'subscriptionId',
                 payload->>'subscription_id', payload->>'subscriptionId'
               ) IS NULL
               AND created_at <= $5::timestamptz
             )
           )
           AND status IN ('pending', 'failed', 'retrying')`,
        [
          user.id,
          paddle.environment,
          snapshot.providerSubscriptionId,
          JSON.stringify({
            resolved_by: 'subscription_state_reconciliation',
            retry_suppressed_reason: 'subscription_cancelled',
          }),
          snapshot.observedAt,
        ],
      )
    }

    const projectionResult = await client.query(
      `INSERT INTO subscriptions (
         paddle_subscription_id, user_id, status, latest_event_type,
         latest_event_payload, paddle_environment
       )
       VALUES ($1, $2, $3, 'subscription.reconciled', $4::jsonb, $5)
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
      [
        snapshot.providerSubscriptionId,
        user.id,
        snapshot.storedStatus,
        JSON.stringify({
          source,
          provider_observed_at: snapshot.observedAt,
          data: dataFromPayload(paddlePayload),
        }),
        paddle.environment,
      ],
    )
    if (projectionResult.rowCount !== 1) {
      const error = new Error('Paddle subscription projection ownership conflict')
      error.code = 'PADDLE_OWNERSHIP_CONFLICT'
      throw error
    }

    await client.query('COMMIT')
    console.info('[Paddle subscription reconciliation] Applied verified provider state', {
      userId: user.id,
      environment: paddle.environment,
      providerCustomerId: snapshot.providerCustomerId,
      providerSubscriptionId: snapshot.providerSubscriptionId,
      previousStatus: user.subscription_status || null,
      providerStatus: snapshot.providerStatus,
      resultingStatus: snapshot.storedStatus,
      previousScheduledCancellation: Boolean(user.cancellation_effective_at),
      scheduledCancellation: Boolean(snapshot.scheduledCancellation),
      result: 'updated',
      stateChanged: true,
      source,
    })
    return {
      reconciled: true,
      providerVerified: true,
      reason: 'updated',
      snapshot,
      user: nextUser,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
