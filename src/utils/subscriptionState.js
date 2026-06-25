const ACTIVE_STATUSES = new Set(['active'])
const TRIALING_STATUSES = new Set(['trialing', 'trial'])
const PAST_DUE_STATUSES = new Set(['past_due', 'past due'])
const CANCELED_STATUSES = new Set(['canceled', 'cancelled'])
const PAUSED_STATUSES = new Set(['paused'])
const INACTIVE_STATUSES = new Set(['inactive', 'no_subscription', 'none', 'free', ''])
const BILLING_MANAGEABLE_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused', 'canceled', 'cancelled'])

export function normalizeSubscriptionStatus(status) {
  return String(status || 'inactive').trim().toLowerCase()
}

export function isTrialing(status) {
  return TRIALING_STATUSES.has(normalizeSubscriptionStatus(status))
}

export function hasActiveSubscription(status) {
  const normalized = normalizeSubscriptionStatus(status)
  return ACTIVE_STATUSES.has(normalized) || TRIALING_STATUSES.has(normalized)
}

export function canAccessProductDashboard(status) {
  return hasActiveSubscription(status)
}

export function canRenderBillingPage(subscriptionState) {
  return Boolean(subscriptionState?.canManageBilling || (subscriptionState?.hasProviderCustomer && subscriptionState?.hasProviderSubscription && !subscriptionState?.isFree))
}

export function resolveSubscriptionState({ user = null, subscription = null } = {}) {
  const rawStatus = normalizeSubscriptionStatus(subscription?.status || user?.subscription_status)
  const hasProviderCustomer = Boolean(subscription?.paddleCustomerId || subscription?.paddle_customer_id || user?.paddleCustomerId || user?.paddle_customer_id)
  const hasProviderSubscription = Boolean(subscription?.paddleSubscriptionId || subscription?.paddle_subscription_id || user?.paddleSubscriptionId || user?.paddle_subscription_id)
  const hasBillingPortalAccess = Boolean(subscription?.hasBillingPortalAccess) || (hasProviderCustomer && hasProviderSubscription)
  const isActive = ACTIVE_STATUSES.has(rawStatus)
  const trialing = TRIALING_STATUSES.has(rawStatus)
  const pastDue = PAST_DUE_STATUSES.has(rawStatus)
  const canceled = CANCELED_STATUSES.has(rawStatus)
  const paused = PAUSED_STATUSES.has(rawStatus)
  const free = INACTIVE_STATUSES.has(rawStatus) && !hasProviderSubscription
  const plan = subscription?.plan || user?.subscription_plan || null

  const statusLabel = isActive
    ? 'Active'
    : trialing
      ? 'Trialing'
      : pastDue
        ? 'Past due'
        : canceled
          ? 'Canceled'
          : paused
            ? 'Paused'
            : 'Free plan / No active subscription'

  return {
    rawStatus,
    statusLabel,
    plan,
    planLabel: plan ? `${String(plan).charAt(0).toUpperCase()}${String(plan).slice(1)}` : 'Free plan',
    isActive,
    isTrialing: trialing,
    isPastDue: pastDue,
    isCanceled: canceled,
    isPaused: paused,
    isFree: free,
    hasProviderCustomer,
    hasProviderSubscription,
    hasBillingPortalAccess,
    canManageBilling: hasBillingPortalAccess && BILLING_MANAGEABLE_STATUSES.has(rawStatus),
    canAccessProductDashboard: isActive || trialing,
  }
}
