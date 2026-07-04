const SCHEDULED_CANCELLATION_STATUSES = new Set([
  'canceled',
  'cancelled',
  'cancel_scheduled',
  'cancellation_scheduled',
  'pending_cancellation',
  'scheduled_cancellation',
])

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase()
}

export function getBillingPlanAction(plan) {
  if (plan === 'monthly') {
    return {
      kind: 'upgrade',
      targetPlan: 'annual',
      label: 'Upgrade to annual',
      isSelfServe: true,
    }
  }

  if (plan === 'annual') {
    return {
      kind: 'support-assisted-cadence-change',
      targetPlan: 'monthly',
      label: 'Need monthly billing? Contact support and we’ll help update your billing cadence safely.',
      isSelfServe: false,
    }
  }

  return null
}

export function getCancelActionLabel(plan) {
  return plan === 'annual' ? 'Cancel renewal' : 'Cancel subscription'
}

export function getFutureCancellationEffectiveDate(subscription, now = new Date()) {
  if (!subscription?.cancellationEffectiveAt) return null
  const effectiveDate = new Date(subscription.cancellationEffectiveAt)
  const comparisonDate = now instanceof Date ? now : new Date(now)

  if (Number.isNaN(effectiveDate.getTime()) || Number.isNaN(comparisonDate.getTime())) return null

  return effectiveDate > comparisonDate ? effectiveDate : null
}

function hasCancellationStatusSignal(subscriptionState, subscription) {
  const subscriptionStatus = normalizeStatus(subscription?.status)
  const latestRecordStatus = normalizeStatus(subscription?.latestRecordStatus)

  return Boolean(
    subscriptionState?.isCanceled
      || subscription?.cancelAtPeriodEnd
      || subscription?.cancel_at_period_end
      || SCHEDULED_CANCELLATION_STATUSES.has(subscriptionStatus)
      || SCHEDULED_CANCELLATION_STATUSES.has(latestRecordStatus),
  )
}

export function hasScheduledCancellation(subscriptionState, subscription, now = new Date()) {
  return Boolean(getFutureCancellationEffectiveDate(subscription, now) && hasCancellationStatusSignal(subscriptionState, subscription))
}

export function hasFutureCancellationEffectiveAt(subscription, now = new Date()) {
  return Boolean(getFutureCancellationEffectiveDate(subscription, now))
}

export function getBillingStatusLabel(subscriptionState, subscription, formatDate = (value) => value, now = new Date()) {
  const effectiveDate = hasScheduledCancellation(subscriptionState, subscription, now)
    ? getFutureCancellationEffectiveDate(subscription, now)
    : null
  if (effectiveDate) return `Active until ${formatDate(effectiveDate)}`

  return subscriptionState?.statusLabel || 'Free plan / No active subscription'
}

export function getCancellationAccessMessage(subscriptionState, subscription, formatDate = (value) => value, now = new Date()) {
  const effectiveDate = hasScheduledCancellation(subscriptionState, subscription, now)
    ? getFutureCancellationEffectiveDate(subscription, now)
    : null
  if (!effectiveDate) return ''

  return `Your access remains active until ${formatDate(effectiveDate)}. You will not be charged again.`
}

export function getCancellationSuccessMessage(subscription, payload, formatDate = (value) => value) {
  const effectiveDate = getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.effectiveAt })
    || getFutureCancellationEffectiveDate(subscription)
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.cancellationEffectiveAt })
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.subscription?.cancellationEffectiveAt })
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.subscription?.currentPeriodEnd })
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.currentPeriodEnd })

  if (effectiveDate) return `Renewal canceled. Your access remains active until ${formatDate(effectiveDate)}.`

  return 'Renewal canceled. Your access remains active through the end of your current billing period.'
}

export function canShowCancelAction(subscriptionState, subscription, now = new Date()) {
  return Boolean(subscriptionState?.canManageBilling && !subscriptionState?.isCanceled && !hasScheduledCancellation(subscriptionState, subscription, now))
}

export function shouldRenderBillingHistory(history) {
  return Array.isArray(history) && history.length > 0
}
