export const ACCOUNT_ACCESS_REFRESH_EVENT = 'hireflow-account-access-refresh'
export const ACCOUNT_ACCESS_REFRESH_INTERVAL_MS = 2 * 60 * 1000
export const ACCOUNT_ACCESS_REFRESH_BOUNDARY_WINDOW_MS = 2 * 60 * 60 * 1000

const REFRESHABLE_SUBSCRIPTION_STATUSES = new Set(['active', 'trial', 'trialing'])

function toTimestamp(value) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function shouldPollAccountAccess(userProfile, subscriptionStatus, now = Date.now()) {
  const normalizedStatus = String(
    subscriptionStatus || userProfile?.subscription_status || '',
  ).trim().toLowerCase()

  if (!REFRESHABLE_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
    return false
  }

  const billingBoundaries = [
    userProfile?.current_period_end,
    userProfile?.currentPeriodEnd,
    userProfile?.next_billing_date,
    userProfile?.nextBillingDate,
    userProfile?.subscription_renewal_date,
    userProfile?.subscriptionRenewalDate,
  ].map(toTimestamp).filter((timestamp) => timestamp !== null)

  return billingBoundaries.some(
    (timestamp) => Math.abs(timestamp - now) <= ACCOUNT_ACCESS_REFRESH_BOUNDARY_WINDOW_MS,
  )
}

export function isSubscriptionAccessDenied(response, payload = {}) {
  if (response?.status !== 403) {
    return false
  }

  return payload?.code === 'SUBSCRIPTION_INACTIVE'
    || payload?.error === 'Subscription inactive'
}

export function notifySubscriptionAccessDenied(response, payload = {}, eventTarget = window) {
  if (!isSubscriptionAccessDenied(response, payload)) {
    return false
  }

  eventTarget.dispatchEvent(new Event(ACCOUNT_ACCESS_REFRESH_EVENT))
  return true
}
