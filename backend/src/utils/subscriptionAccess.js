const ACTIVE_PAID_STATUSES = new Set(['active', 'trialing', 'trial'])
const SCHEDULED_CANCELLATION_STATUSES = new Set(['canceled', 'cancelled', 'cancel_scheduled', 'cancellation_scheduled', 'pending_cancellation', 'scheduled_cancellation'])

export function normalizeSubscriptionStatus(status) {
  return String(status || 'inactive').trim().toLowerCase()
}

export function getFutureSubscriptionEndDate(user, now = new Date()) {
  const rawDate = user?.cancellation_effective_at || user?.cancellationEffectiveAt || user?.current_period_end || user?.currentPeriodEnd
  if (!rawDate) return null

  const endDate = new Date(rawDate)
  const comparisonDate = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(endDate.getTime()) || Number.isNaN(comparisonDate.getTime())) return null

  return endDate > comparisonDate ? endDate : null
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
