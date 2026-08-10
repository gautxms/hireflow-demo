import { pool } from '../db/client.js'

function validIsoOrNull(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : String(value)
}

function subscriptionData(payload = {}) {
  return payload?.data || payload || {}
}

function scheduledCancellationEffectiveAt(data = {}) {
  const scheduledChange = data?.scheduled_change || data?.scheduledChange || null
  const action = String(scheduledChange?.action || scheduledChange?.type || '').trim().toLowerCase()
  if (!action.includes('cancel')) return null
  return validIsoOrNull(scheduledChange?.effective_at || scheduledChange?.effectiveAt)
}

export function getPaddleLifecycleDates(payload, normalizedStatus) {
  const data = subscriptionData(payload)
  const currentPeriodStart = validIsoOrNull(
    data?.current_billing_period?.starts_at || data?.billing_period?.starts_at,
  )
  const currentPeriodEnd = validIsoOrNull(
    data?.current_billing_period?.ends_at || data?.billing_period?.ends_at,
  )
  const nextBillingDate = validIsoOrNull(data?.next_billed_at)
  const scheduledCancellationAt = scheduledCancellationEffectiveAt(data)
  const terminalCancellationAt = normalizedStatus === 'cancelled'
    ? validIsoOrNull(
      data?.canceled_at
        || data?.cancelled_at
        || scheduledCancellationAt
        || currentPeriodEnd,
    )
    : null

  return {
    currentPeriodStart,
    currentPeriodEnd,
    nextBillingDate,
    scheduledCancellationAt,
    terminalCancellationAt,
    trialEndsAt: normalizedStatus === 'trialing'
      ? (currentPeriodEnd || nextBillingDate)
      : null,
  }
}

export async function applyPaddleSubscriptionLifecycle({
  db = pool,
  user,
  subscriptionId,
  customerId,
  environment,
  eventType,
  status,
  plan,
  providerEventAt,
  payload,
}) {
  if (!user?.id || !subscriptionId || !customerId || !environment || !eventType || !status) {
    return { applied: false, reason: 'lifecycle_identity_incomplete' }
  }

  const dates = getPaddleLifecycleDates(payload, status)
  const isTerminal = status === 'cancelled'
  const serializedPayload = JSON.stringify(payload)

  // This single PostgreSQL statement keeps the operational users cache and the
  // subscriptions projection atomic. The consistency guard deliberately raises
  // if an eligible users mutation cannot produce the matching projection row.
  const result = await db.query(
    `WITH updated_user AS (
       UPDATE users account
       SET paddle_subscription_id = $2,
           subscription_status = $3,
           paddle_customer_id = COALESCE(account.paddle_customer_id, $4),
           subscription_plan = COALESCE($5, account.subscription_plan),
           current_period_end = COALESCE($6::timestamp, account.current_period_end),
           subscription_renewal_date = CASE WHEN $15::boolean THEN NULL ELSE $6::timestamp END,
           next_billing_date = CASE WHEN $15::boolean THEN NULL ELSE $7::timestamp END,
           cancellation_effective_at = CASE
             WHEN $15::boolean THEN COALESCE($16::timestamp, $9::timestamp, $6::timestamp, NOW())
             ELSE $9::timestamp
           END,
           cancellation_reason = CASE
             WHEN NOT $15::boolean AND $9::timestamp IS NULL THEN NULL
             ELSE account.cancellation_reason
           END,
           subscription_started_at = CASE
             WHEN $3 IN ('active', 'trialing') THEN COALESCE(account.subscription_started_at, NOW())
             ELSE account.subscription_started_at
           END,
           quota_anchor_at = CASE
             WHEN $3 = 'active' THEN COALESCE(account.quota_anchor_at, $10::timestamp)
             ELSE account.quota_anchor_at
           END,
           trial_ends_at = CASE
             WHEN $3 = 'trialing' THEN COALESCE($14::timestamp, account.trial_ends_at)
             ELSE account.trial_ends_at
           END,
           trial_consumed_at = CASE
             WHEN $3 IN ('active', 'trialing') THEN COALESCE(account.trial_consumed_at, NOW())
             ELSE account.trial_consumed_at
           END,
           paddle_environment = $8,
           last_paddle_event_at = CASE
             WHEN $11::timestamptz IS NULL THEN account.last_paddle_event_at
             ELSE $11::timestamptz
           END,
           updated_at = NOW()
       WHERE account.id = $1
         AND $2::text IS NOT NULL
         AND $4::text IS NOT NULL
         AND $3::text IN ('active', 'trialing', 'past_due', 'paused', 'cancelled')
         AND ($4 = account.paddle_customer_id OR account.paddle_customer_id IS NULL)
         AND COALESCE(NULLIF(LOWER(account.paddle_environment), ''), $8) = $8
         AND (
           account.last_paddle_event_at IS NULL
           OR ($11::timestamptz IS NOT NULL AND $11::timestamptz > account.last_paddle_event_at)
         )
         AND (
           account.last_paddle_event_at IS NOT NULL
           OR $6::timestamp IS NULL
           OR account.current_period_end IS NULL
           OR $6::timestamp >= account.current_period_end
         )
         AND NOT (
           $3 = 'trialing'
           AND account.trial_consumed_at IS NOT NULL
           AND account.paddle_subscription_id IS DISTINCT FROM $2
         )
         AND (
           (
             (account.paddle_subscription_id IS NULL OR account.paddle_subscription_id = $2)
             AND NOT (
               $3 IN ('active', 'trialing')
               AND LOWER(COALESCE(account.subscription_status, '')) IN ('canceled', 'cancelled')
               AND (account.cancellation_effective_at IS NULL OR account.cancellation_effective_at <= NOW())
             )
           )
           OR (
             account.paddle_subscription_id IS DISTINCT FROM $2
             AND $3 = 'active'
             AND $5::text IS NOT NULL
             AND $6::timestamp IS NOT NULL
             AND LOWER(COALESCE(account.subscription_status, '')) IN ('canceled', 'cancelled')
             AND (account.cancellation_effective_at IS NULL OR account.cancellation_effective_at <= NOW())
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM subscriptions existing_projection
           WHERE existing_projection.paddle_subscription_id = $2
             AND COALESCE(NULLIF(LOWER(existing_projection.paddle_environment), ''), 'production') = $8
             AND (
               (existing_projection.user_id IS NOT NULL AND existing_projection.user_id <> account.id)
               OR (
                 COALESCE(
                   existing_projection.latest_event_payload #>> '{occurred_at}',
                   existing_projection.latest_event_payload #>> '{notification,occurred_at}',
                   existing_projection.latest_event_payload #>> '{provider_observed_at}'
                 ) IS NOT NULL
                 AND (
                   $11::timestamptz IS NULL
                   OR COALESCE(
                     existing_projection.latest_event_payload #>> '{occurred_at}',
                     existing_projection.latest_event_payload #>> '{notification,occurred_at}',
                     existing_projection.latest_event_payload #>> '{provider_observed_at}'
                   )::timestamptz >= $11::timestamptz
                 )
               )
               OR (
                 $11::timestamptz IS NULL
                 AND COALESCE(
                   existing_projection.latest_event_payload #>> '{data,current_billing_period,ends_at}',
                   existing_projection.latest_event_payload #>> '{data,billing_period,ends_at}'
                 ) IS NOT NULL
                 AND (
                   $6::timestamp IS NULL
                   OR COALESCE(
                     existing_projection.latest_event_payload #>> '{data,current_billing_period,ends_at}',
                     existing_projection.latest_event_payload #>> '{data,billing_period,ends_at}'
                   )::timestamp >= $6::timestamp
                 )
               )
             )
         )
       RETURNING account.id
     ), upserted_subscription AS (
       INSERT INTO subscriptions (
         paddle_subscription_id, user_id, status, latest_event_type,
         latest_event_payload, paddle_environment
       )
       SELECT $2, updated_user.id, $3, $12, $13::jsonb, $8
       FROM updated_user
       ON CONFLICT (paddle_environment, paddle_subscription_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         status = EXCLUDED.status,
         latest_event_type = EXCLUDED.latest_event_type,
         latest_event_payload = EXCLUDED.latest_event_payload,
         paddle_environment = EXCLUDED.paddle_environment,
         updated_at = NOW()
       WHERE subscriptions.user_id IS NULL OR subscriptions.user_id = EXCLUDED.user_id
       RETURNING user_id
     )
     SELECT CASE
       WHEN EXISTS (SELECT 1 FROM updated_user)
         AND NOT EXISTS (SELECT 1 FROM upserted_subscription)
       THEN 1 / (SELECT COUNT(*)::integer FROM upserted_subscription)
       ELSE (SELECT COUNT(*)::integer FROM upserted_subscription)
     END AS applied`,
    [
      user.id,
      subscriptionId,
      status,
      customerId,
      plan || null,
      dates.currentPeriodEnd,
      dates.nextBillingDate,
      environment,
      dates.scheduledCancellationAt,
      dates.currentPeriodStart,
      validIsoOrNull(providerEventAt),
      eventType,
      serializedPayload,
      dates.trialEndsAt,
      isTerminal,
      dates.terminalCancellationAt,
    ],
  )

  const applied = Number(result.rows?.[0]?.applied ?? (result.rowCount > 0 ? 1 : 0)) === 1
  return {
    applied,
    reason: applied ? null : 'stale_conflicting_or_ineligible_lifecycle',
    dates,
  }
}
