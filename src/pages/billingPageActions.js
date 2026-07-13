import { getFutureSubscriptionEndDate, hasExplicitScheduledCancellationSignal, hasScheduledCancellationAccess } from '../utils/subscriptionState.js'


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

export function getCancelActionLabel(_plan) {
  return 'Cancel subscription'
}

export function shouldShowPlanActionSupportNote(planAction, subscriptionState, subscription, now = new Date()) {
  return Boolean(planAction && !planAction.isSelfServe && !hasScheduledCancellation(subscriptionState, subscription, now))
}

function buildBillingAccessInput(subscriptionState, subscription) {
  return {
    status: subscription?.status || subscriptionState?.rawStatus || subscriptionState?.status,
    rawStatus: subscriptionState?.rawStatus,
    cancellationEffectiveAt: subscription?.cancellationEffectiveAt || subscriptionState?.cancellationEffectiveAt,
    cancellation_effective_at: subscription?.cancellation_effective_at || subscriptionState?.cancellation_effective_at,
    accessEndsAt: subscription?.accessEndsAt || subscriptionState?.accessEndsAt,
    access_ends_at: subscription?.access_ends_at || subscriptionState?.access_ends_at,
    paidThroughDate: subscription?.paidThroughDate || subscriptionState?.paidThroughDate,
    paid_through_date: subscription?.paid_through_date || subscriptionState?.paid_through_date,
    currentPeriodEnd: subscription?.currentPeriodEnd || subscriptionState?.currentPeriodEnd,
    current_period_end: subscription?.current_period_end || subscriptionState?.current_period_end,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? subscriptionState?.cancelAtPeriodEnd,
    cancel_at_period_end: subscription?.cancel_at_period_end ?? subscriptionState?.cancel_at_period_end,
    latestRecordStatus: subscription?.latestRecordStatus || subscriptionState?.latestRecordStatus,
    latest_record_status: subscription?.latest_record_status || subscriptionState?.latest_record_status,
  }
}

export function getFutureCancellationEffectiveDate(subscription, now = new Date()) {
  return getFutureSubscriptionEndDate(subscription, now)
}

export function hasCancellationSignal(subscriptionState, subscription) {
  return Boolean(subscriptionState?.hasCancellationSignal || hasExplicitScheduledCancellationSignal(buildBillingAccessInput(subscriptionState, subscription)))
}

export function hasScheduledCancellation(subscriptionState, subscription, now = new Date()) {
  return hasScheduledCancellationAccess(buildBillingAccessInput(subscriptionState, subscription), now)
}

export function hasFutureCancellationEffectiveAt(subscription, now = new Date()) {
  return Boolean(getFutureCancellationEffectiveDate(subscription, now))
}

export function getBillingStatusLabel(subscriptionState, subscription, formatDate = (value) => value, now = new Date()) {
  const effectiveDate = hasScheduledCancellation(subscriptionState, subscription, now)
    ? getFutureCancellationEffectiveDate(subscription, now)
    : null
  if (effectiveDate) return `Access until ${formatDate(effectiveDate)}`

  return subscriptionState?.statusLabel || 'No active subscription'
}

export function getCancellationAccessMessage(subscriptionState, subscription, formatDate = (value) => value, now = new Date()) {
  const effectiveDate = hasScheduledCancellation(subscriptionState, subscription, now)
    ? getFutureCancellationEffectiveDate(subscription, now)
    : null
  if (!effectiveDate) {
    return hasCancellationSignal(subscriptionState, subscription)
      ? 'Cancellation is being reconciled. Contact support if this status does not update.'
      : ''
  }

  return `Subscription canceled. Your access remains active until ${formatDate(effectiveDate)}. You will not be charged again.`
}

export function getCancellationSuccessMessage(subscription, payload, formatDate = (value) => value) {
  const effectiveDate = getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.effectiveAt })
    || getFutureCancellationEffectiveDate(subscription)
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.cancellationEffectiveAt })
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.subscription?.cancellationEffectiveAt })
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.subscription?.currentPeriodEnd })
    || getFutureCancellationEffectiveDate({ cancellationEffectiveAt: payload?.currentPeriodEnd })

  if (effectiveDate) return `Subscription canceled. Your access remains active until ${formatDate(effectiveDate)}.`

  return 'Subscription canceled. Your access remains active through the end of your current billing period.'
}

export function canShowCancelAction(subscriptionState, subscription, now = new Date()) {
  return Boolean(subscriptionState?.canManageBilling && !hasCancellationSignal(subscriptionState, subscription) && !hasScheduledCancellation(subscriptionState, subscription, now))
}

export function shouldRenderBillingHistory(history) {
  return Array.isArray(history) && history.length > 0
}
