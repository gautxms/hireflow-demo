const ACTIVE_PAID_STATUSES = new Set(['active', 'trialing', 'trial'])
const READ_ONLY_WORKSPACE_STATUSES = new Set(['past_due', 'payment_failed', 'paused', 'inactive', 'no_subscription', 'none', 'free', '', 'canceled', 'cancelled'])
const CANCELED_STATUSES = new Set(['canceled', 'cancelled'])
const SCHEDULED_CANCELLATION_STATUSES = new Set(['canceled', 'cancelled', 'cancel_scheduled', 'cancellation_scheduled', 'pending_cancellation', 'scheduled_cancellation'])

export function normalizeSubscriptionStatus(status) {
  return String(status || 'inactive').trim().toLowerCase()
}

function parseFutureDate(rawDate, now) {
  if (!rawDate) return null

  const endDate = new Date(rawDate)
  const comparisonDate = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(endDate.getTime()) || Number.isNaN(comparisonDate.getTime())) return null

  return endDate > comparisonDate ? endDate : null
}

export function getFutureSubscriptionEndDate(user, now = new Date()) {
  const status = normalizeSubscriptionStatus(user?.subscription_status || user?.status)
  const cancellationEffectiveAt = user?.cancellation_effective_at ?? user?.cancellationEffectiveAt

  // A terminal cancellation cannot borrow access from an older future billing
  // period. Only an explicit future cancellation-effective date proves access.
  if (CANCELED_STATUSES.has(status)) {
    return parseFutureDate(cancellationEffectiveAt, now)
  }

  return parseFutureDate(
    cancellationEffectiveAt || user?.current_period_end || user?.currentPeriodEnd,
    now,
  )
}

export function hasScheduledCancellationAccess(user, now = new Date()) {
  const status = normalizeSubscriptionStatus(user?.subscription_status || user?.status)
  return Boolean(SCHEDULED_CANCELLATION_STATUSES.has(status) && getFutureSubscriptionEndDate(user, now))
}

export function hasActivePaidAccess(user, now = new Date()) {
  const status = normalizeSubscriptionStatus(user?.subscription_status || user?.status)
  return ACTIVE_PAID_STATUSES.has(status) || hasScheduledCancellationAccess(user, now)
}

export function isReadOnlyExpiredSubscriber(user, now = new Date()) {
  const status = normalizeSubscriptionStatus(user?.subscription_status || user?.status)
  return Boolean(SCHEDULED_CANCELLATION_STATUSES.has(status) && !getFutureSubscriptionEndDate(user, now))
}

export function canUsePaidMutation(user, now = new Date()) {
  return hasActivePaidAccess(user, now)
}

export function isReadOnlyWorkspaceAccess(user, { hasHistoricalData = false, now = new Date() } = {}) {
  if (!user || !hasHistoricalData) return false
  if (hasActivePaidAccess(user, now)) return false

  const status = normalizeSubscriptionStatus(user?.subscription_status || user?.status)
  return READ_ONLY_WORKSPACE_STATUSES.has(status) || isReadOnlyExpiredSubscriber(user, now)
}
