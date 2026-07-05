import { canAccessProductDashboard } from './subscriptionState.js'

export { hasActiveSubscription, canAccessProductDashboard } from './subscriptionState.js'

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
