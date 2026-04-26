const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])

export function hasActiveSubscription(subscriptionStatus = 'inactive') {
  return ACTIVE_SUBSCRIPTION_STATUSES.has((subscriptionStatus || '').toLowerCase())
}

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

  if (hasActiveSubscription(subscriptionStatus)) {
    return true
  }

  onRequireUpgrade()
  return false
}
