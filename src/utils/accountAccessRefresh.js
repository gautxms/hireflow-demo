export const ACCOUNT_ACCESS_REFRESH_EVENT = 'hireflow-account-access-refresh'
export const ACCOUNT_ACCESS_REFRESH_INTERVAL_MS = 30_000

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
