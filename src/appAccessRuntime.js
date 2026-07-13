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
  const workspaceAccessForFlags = isAccessAuthoritative ? canAccessProductDashboard(profileBillingState) : false
  const isActiveSubscriber = isAccessAuthoritative && canAccessProductDashboard(profileBillingState)
  const canViewUpgradePricing = !isAuthenticated || (isAccessAuthoritative && !isActiveSubscriber)

  return {
    profileBillingState,
    isAccessAuthoritative,
    workspaceAccessForFlags,
    isActiveSubscriber,
    canViewUpgradePricing,
  }
}
