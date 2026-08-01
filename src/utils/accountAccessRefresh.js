export const ACCOUNT_ACCESS_REFRESH_EVENT = 'hireflow-account-access-refresh'
export const ACCOUNT_ACCESS_REFRESH_INTERVAL_MS = 2 * 60 * 1000
export const ACCOUNT_ACCESS_REFRESH_BOUNDARY_WINDOW_MS = 2 * 60 * 60 * 1000
export const ACCOUNT_ACCESS_REFRESH_POST_BOUNDARY_WINDOW_MS = 3 * 60 * 60 * 1000
export const ACCOUNT_ACCESS_REFRESH_WAKEUP_RECHECK_MS = 24 * 60 * 60 * 1000

const REFRESHABLE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trial',
  'trialing',
  'canceled',
  'cancelled',
  'cancel_scheduled',
  'cancellation_scheduled',
  'pending_cancellation',
  'scheduled_cancellation',
])

function toTimestamp(value) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function getAccountAccessPollingStartDelay(userProfile, subscriptionStatus, now = Date.now()) {
  const normalizedStatus = String(
    subscriptionStatus || userProfile?.subscription_status || '',
  ).trim().toLowerCase()

  if (!REFRESHABLE_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
    return null
  }

  const billingBoundaries = [
    userProfile?.current_period_end,
    userProfile?.currentPeriodEnd,
    userProfile?.next_billing_date,
    userProfile?.nextBillingDate,
    userProfile?.subscription_renewal_date,
    userProfile?.subscriptionRenewalDate,
    userProfile?.cancellation_effective_at,
    userProfile?.cancellationEffectiveAt,
  ].map(toTimestamp).filter((timestamp) => timestamp !== null)

  const startDelays = billingBoundaries.map((timestamp) => {
    const windowStart = timestamp - ACCOUNT_ACCESS_REFRESH_BOUNDARY_WINDOW_MS
    const windowEnd = timestamp + ACCOUNT_ACCESS_REFRESH_POST_BOUNDARY_WINDOW_MS

    if (now > windowEnd) {
      return null
    }

    return Math.max(0, windowStart - now)
  }).filter((delay) => delay !== null)

  return startDelays.length > 0 ? Math.min(...startDelays) : null
}

export function shouldPollAccountAccess(userProfile, subscriptionStatus, now = Date.now()) {
  return getAccountAccessPollingStartDelay(userProfile, subscriptionStatus, now) === 0
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

export async function fetchWithAccountAccessRefresh(
  input,
  init,
  { fetchImpl = globalThis.fetch, eventTarget = globalThis.window } = {},
) {
  const response = await fetchImpl(input, init)

  if (response?.status === 403 && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json()
      notifySubscriptionAccessDenied(response, payload, eventTarget)
    } catch {
      // Preserve the original response when a non-JSON 403 is returned.
    }
  }

  return response
}
