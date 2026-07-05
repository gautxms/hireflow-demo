import { canAccessProductDashboard } from './subscriptionState'

export { hasActiveSubscription, canAccessProductDashboard } from './subscriptionState'

export function guardAuthenticatedRoute({
  isAuthenticated,
  promptMessage,
  onRequireAuth,
}) {
  if (isAuthenticated) {
    return true
  }

  onRequireAuth(promptMessage)
  return false
}

export function guardSubscriptionRoute({
  isAuthenticated,
  subscriptionStatus,
  subscriptionState,
  onRequireAuth,
  onRequireUpgrade,
  authPromptMessage,
}) {
  const isAllowedByAuth = guardAuthenticatedRoute({
    isAuthenticated,
    promptMessage: authPromptMessage,
    onRequireAuth,
  })

  if (!isAllowedByAuth) {
    return false
  }

  if (canAccessProductDashboard(subscriptionState || subscriptionStatus)) {
    return true
  }

  onRequireUpgrade()
  return false
}
