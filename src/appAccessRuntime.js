import { resolveSubscriptionState } from './utils/subscriptionState.js'
import { canAccessProductDashboard } from './utils/routeGuards.js'

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
  const canViewUpgradePricing = !isAuthenticated || (isAccessAuthoritative && !isActiveSubscriber)

  return {
    profileBillingState,
    isAccessAuthoritative,
    hasAuthoritativeAuthenticatedAccess,
    workspaceAccessForFlags,
    isActiveSubscriber,
    canViewUpgradePricing,
  }
}
