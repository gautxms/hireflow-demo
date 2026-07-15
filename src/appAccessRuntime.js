import { resolveSubscriptionState } from './utils/subscriptionState.js'
import { canAccessProductDashboard } from './utils/routeGuards.js'

export function canViewHistoricalWorkspaceModule(featureEnabled, subscriptionState = null) {
  return Boolean(
    featureEnabled
      || (subscriptionState?.isReadOnlyWorkspace && !subscriptionState?.canUsePaidMutation),
  )
}

export function buildReadOnlyWorkspaceNotice(subscriptionState = null) {
  if (!subscriptionState?.isReadOnlyWorkspace || subscriptionState?.canUsePaidMutation) {
    return null
  }

  if (subscriptionState.isPastDue) {
    return {
      title: 'Payment required',
      description: 'Your historical workspace remains available in read-only mode. Review billing to restore recruiting actions.',
      actionLabel: 'Review billing',
      actionPath: '/billing',
    }
  }

  if (subscriptionState.isPaused) {
    return {
      title: 'Subscription paused',
      description: 'Your historical workspace remains available in read-only mode. Review billing to resume recruiting actions.',
      actionLabel: 'Review billing',
      actionPath: '/billing',
    }
  }

  return {
    title: 'Read-only access',
    description: 'Your historical data remains available. Choose a plan to create analyses or change recruiting workflows.',
    actionLabel: 'View plans',
    actionPath: '/pricing',
  }
}

export function buildResolvedAccessContext({
  isAuthenticated = false,
  accessResolutionStatus = 'resolved',
  subscriptionStatus = 'inactive',
  userProfile = null,
} = {}) {
  const profileBillingState = resolveSubscriptionState({
    user: userProfile
      ? { ...userProfile, subscription_status: userProfile.subscription_status || subscriptionStatus }
      : { subscription_status: subscriptionStatus },
  })
  const isAccessAuthoritative = !isAuthenticated || accessResolutionStatus === 'resolved'
  const hasAuthoritativeAuthenticatedAccess = isAuthenticated && accessResolutionStatus === 'resolved'
  const workspaceAccessForFlags = hasAuthoritativeAuthenticatedAccess
    ? canAccessProductDashboard(profileBillingState)
    : false
  const isActiveSubscriber = hasAuthoritativeAuthenticatedAccess && canAccessProductDashboard(profileBillingState)
  const canOpenWorkspaceDashboard = hasAuthoritativeAuthenticatedAccess
    && (isActiveSubscriber || profileBillingState.isReadOnlyWorkspace)
  const canViewUpgradePricing = !isAuthenticated || (isAccessAuthoritative && !isActiveSubscriber)

  return {
    profileBillingState,
    isAccessAuthoritative,
    hasAuthoritativeAuthenticatedAccess,
    workspaceAccessForFlags,
    isActiveSubscriber,
    canOpenWorkspaceDashboard,
    canViewUpgradePricing,
  }
}
