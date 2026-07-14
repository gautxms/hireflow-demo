const ACTIVE_STATUSES = new Set(['active'])
const TRIALING_STATUSES = new Set(['trialing', 'trial'])
const PAST_DUE_STATUSES = new Set(['past_due', 'past due', 'payment_failed'])
const CANCELED_STATUSES = new Set(['canceled', 'cancelled'])
const SCHEDULED_CANCELLATION_STATUSES = new Set([
  'canceled',
  'cancelled',
  'cancel_scheduled',
  'cancellation_scheduled',
  'pending_cancellation',
  'scheduled_cancellation',
])
const PAUSED_STATUSES = new Set(['paused'])
const INACTIVE_STATUSES = new Set(['inactive', 'no_subscription', 'none', 'free', ''])
const BILLING_MANAGEABLE_STATUSES = new Set([
  'active',
  'trialing',
  'trial',
  'past_due',
  'payment_failed',
  'paused',
  'canceled',
  'cancelled',
  'cancel_scheduled',
  'cancellation_scheduled',
  'pending_cancellation',
  'scheduled_cancellation',
])

export function normalizeSubscriptionStatus(status) {
  return String(status || 'inactive').trim().toLowerCase()
}

function normalizeSignalStatus(status) {
  return String(status || '').trim().toLowerCase()
}

export function isTrialing(status) {
  return TRIALING_STATUSES.has(normalizeSubscriptionStatus(status))
}

export function hasActiveSubscription(status) {
  const normalized = normalizeSubscriptionStatus(status)
  return ACTIVE_STATUSES.has(normalized) || TRIALING_STATUSES.has(normalized)
}

function getSubscriptionStatus(subscriptionStateOrSubscription) {
  if (typeof subscriptionStateOrSubscription === 'string') {
    return normalizeSubscriptionStatus(subscriptionStateOrSubscription)
  }

  return normalizeSubscriptionStatus(subscriptionStateOrSubscription?.rawStatus || subscriptionStateOrSubscription?.status || subscriptionStateOrSubscription?.subscription_status)
}

export function hasExplicitScheduledCancellationSignal(subscriptionStateOrSubscription) {
  const status = getSubscriptionStatus(subscriptionStateOrSubscription)
  const latestRecordStatus = normalizeSignalStatus(subscriptionStateOrSubscription?.latestRecordStatus || subscriptionStateOrSubscription?.latest_record_status)

  return Boolean(
    SCHEDULED_CANCELLATION_STATUSES.has(status)
      || subscriptionStateOrSubscription?.cancelAtPeriodEnd === true
      || subscriptionStateOrSubscription?.cancel_at_period_end === true
      || SCHEDULED_CANCELLATION_STATUSES.has(latestRecordStatus),
  )
}

export function getFutureSubscriptionEndDate(subscriptionStateOrSubscription, now = new Date()) {
  const comparisonDate = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(comparisonDate.getTime())) return null

  const dateCandidates = [
    subscriptionStateOrSubscription?.cancellationEffectiveAt,
    subscriptionStateOrSubscription?.cancellation_effective_at,
    subscriptionStateOrSubscription?.accessEndsAt,
    subscriptionStateOrSubscription?.access_ends_at,
    subscriptionStateOrSubscription?.paidThroughDate,
    subscriptionStateOrSubscription?.paid_through_date,
    subscriptionStateOrSubscription?.currentPeriodEnd,
    subscriptionStateOrSubscription?.current_period_end,
  ]

  for (const rawDate of dateCandidates) {
    if (rawDate === undefined || rawDate === null || rawDate === '') continue

    const endDate = new Date(rawDate)
    if (Number.isNaN(endDate.getTime())) continue
    if (endDate <= comparisonDate) continue

    return endDate
  }

  return null
}

export function hasScheduledCancellationAccess(subscriptionStateOrSubscription, now = new Date()) {
  const status = getSubscriptionStatus(subscriptionStateOrSubscription)
  if (INACTIVE_STATUSES.has(status)) {
    return false
  }

  return Boolean(
    hasExplicitScheduledCancellationSignal(subscriptionStateOrSubscription)
      && getFutureSubscriptionEndDate(subscriptionStateOrSubscription, now),
  )
}

export function hasActivePaidAccess(subscriptionStateOrSubscription, now = new Date()) {
  const status = getSubscriptionStatus(subscriptionStateOrSubscription)
  return ACTIVE_STATUSES.has(status) || TRIALING_STATUSES.has(status) || hasScheduledCancellationAccess(subscriptionStateOrSubscription, now)
}

export function isReadOnlyExpiredSubscriber(subscriptionStateOrSubscription, now = new Date()) {
  const status = getSubscriptionStatus(subscriptionStateOrSubscription)
  if (INACTIVE_STATUSES.has(status) || ACTIVE_STATUSES.has(status) || TRIALING_STATUSES.has(status)) {
    return false
  }

  return Boolean(
    hasExplicitScheduledCancellationSignal(subscriptionStateOrSubscription)
      && !getFutureSubscriptionEndDate(subscriptionStateOrSubscription, now),
  )
}

export function canUsePaidMutation(subscriptionStateOrSubscription, now = new Date()) {
  return hasActivePaidAccess(subscriptionStateOrSubscription, now)
}

export function isReadOnlyWorkspace(subscriptionStateOrSubscription, { hasHistoricalData = false, now = new Date() } = {}) {
  if (!subscriptionStateOrSubscription || !hasHistoricalData) {
    return false
  }

  if (hasActivePaidAccess(subscriptionStateOrSubscription, now)) {
    return false
  }

  const status = getSubscriptionStatus(subscriptionStateOrSubscription)
  const readOnlyStatuses = new Set([
    ...PAST_DUE_STATUSES,
    ...CANCELED_STATUSES,
    ...INACTIVE_STATUSES,
  ])

  return readOnlyStatuses.has(status) || isReadOnlyExpiredSubscriber(subscriptionStateOrSubscription, now)
}

export function canAccessProductDashboard(subscriptionStateOrSubscription, now = new Date()) {
  return hasActivePaidAccess(subscriptionStateOrSubscription, now)
}

export function canRenderBillingPage(subscriptionState) {
  return Boolean(subscriptionState?.canManageBilling || (subscriptionState?.hasProviderCustomer && subscriptionState?.hasProviderSubscription && !subscriptionState?.isFree))
}

function buildSubscriptionAccessInput({ user = null, subscription = null, rawStatus = 'inactive' } = {}) {
  return {
    status: rawStatus,
    subscription_status: rawStatus,
    cancellationEffectiveAt: subscription?.cancellationEffectiveAt || subscription?.cancellation_effective_at || user?.cancellationEffectiveAt || user?.cancellation_effective_at || null,
    cancellation_effective_at: subscription?.cancellation_effective_at || user?.cancellation_effective_at || subscription?.cancellationEffectiveAt || user?.cancellationEffectiveAt || null,
    accessEndsAt: subscription?.accessEndsAt || subscription?.access_ends_at || user?.accessEndsAt || user?.access_ends_at || null,
    access_ends_at: subscription?.access_ends_at || user?.access_ends_at || subscription?.accessEndsAt || user?.accessEndsAt || null,
    paidThroughDate: subscription?.paidThroughDate || subscription?.paid_through_date || user?.paidThroughDate || user?.paid_through_date || null,
    paid_through_date: subscription?.paid_through_date || user?.paid_through_date || subscription?.paidThroughDate || user?.paidThroughDate || null,
    currentPeriodEnd: subscription?.currentPeriodEnd || subscription?.current_period_end || user?.currentPeriodEnd || user?.current_period_end || null,
    current_period_end: subscription?.current_period_end || user?.current_period_end || subscription?.currentPeriodEnd || user?.currentPeriodEnd || null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? user?.cancelAtPeriodEnd ?? false,
    cancel_at_period_end: subscription?.cancel_at_period_end ?? user?.cancel_at_period_end ?? false,
    latestRecordStatus: subscription?.latestRecordStatus || user?.latestRecordStatus || null,
    latest_record_status: subscription?.latest_record_status || user?.latest_record_status || null,
  }
}

export function resolveSubscriptionState({ user = null, subscription = null, now = new Date() } = {}) {
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
  const accessInput = buildSubscriptionAccessInput({ user, subscription, rawStatus })
  const accessEndsAt = getFutureSubscriptionEndDate(accessInput, now)
  const hasCancellationSignal = hasExplicitScheduledCancellationSignal(accessInput) && !INACTIVE_STATUSES.has(rawStatus)
  const isCancellationScheduled = hasScheduledCancellationAccess(accessInput, now)
  const activePaidAccess = hasActivePaidAccess(accessInput, now)
  const readOnlyExpiredSubscriber = isReadOnlyExpiredSubscriber(accessInput, now)
  const canUseMutation = canUsePaidMutation(accessInput, now)
  const cancelAtPeriodEnd = Boolean(accessInput.cancelAtPeriodEnd || accessInput.cancel_at_period_end || isCancellationScheduled)

  const statusLabel = isCancellationScheduled
    ? 'Cancellation scheduled'
    : isActive
      ? 'Active'
      : trialing
        ? 'Trialing'
        : pastDue
          ? 'Past due'
          : paused
            ? 'Paused'
            : canceled
              ? 'Canceled'
              : 'No active subscription'

  return {
    rawStatus,
    statusLabel,
    plan,
    planLabel: plan ? `${String(plan).charAt(0).toUpperCase()}${String(plan).slice(1)}` : 'No active subscription',
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
    cancellationEffectiveAt: accessInput.cancellationEffectiveAt,
    currentPeriodEnd: accessInput.currentPeriodEnd,
    latestRecordStatus: accessInput.latestRecordStatus,
    cancelAtPeriodEnd,
    hasCancellationSignal,
    isCancellationScheduled,
    accessEndsAt: accessEndsAt ? accessEndsAt.toISOString() : null,
    paidThroughDate: accessEndsAt ? accessEndsAt.toISOString() : null,
    hasActivePaidAccess: activePaidAccess,
    hasScheduledCancellationAccess: isCancellationScheduled,
    isReadOnlyExpiredSubscriber: readOnlyExpiredSubscriber,
    isReadOnlyWorkspace: isReadOnlyWorkspace(accessInput, { hasHistoricalData: Boolean(subscription?.hasHistoricalData || user?.hasHistoricalData), now }),
    canUsePaidMutation: canUseMutation,
    canAccessProductDashboard: activePaidAccess,
  }
}
