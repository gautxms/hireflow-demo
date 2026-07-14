import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResolvedAccessContext } from './appAccessRuntime.js'

const FUTURE_END = '2999-01-01T00:00:00.000Z'

test('logged out stale active profile cannot grant workspace access', () => {
  const context = buildResolvedAccessContext({
    isAuthenticated: false,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'active',
    userProfile: { subscription_status: 'active' },
  })

  assert.equal(context.isAccessAuthoritative, true)
  assert.equal(context.hasAuthoritativeAuthenticatedAccess, false)
  assert.equal(context.isActiveSubscriber, false)
  assert.equal(context.workspaceAccessForFlags, false)
  assert.equal(context.canViewUpgradePricing, true)
})

test('logged out stale paid-through cancellation profile cannot grant workspace access', () => {
  const context = buildResolvedAccessContext({
    isAuthenticated: false,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'canceled',
    userProfile: {
      subscription_status: 'canceled',
      currentPeriodEnd: FUTURE_END,
      cancelAtPeriodEnd: true,
    },
  })

  assert.equal(context.hasAuthoritativeAuthenticatedAccess, false)
  assert.equal(context.isActiveSubscriber, false)
  assert.equal(context.workspaceAccessForFlags, false)
  assert.equal(context.profileBillingState.canAccessProductDashboard, true)
})

test('cross-tab logout transition cannot leave public CTA resolved to Dashboard', () => {
  const context = buildResolvedAccessContext({
    isAuthenticated: false,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'active',
    userProfile: { subscription_status: 'active', name: 'Previous Account' },
  })

  const landingCtaLabel = context.isActiveSubscriber ? 'Dashboard' : 'View pricing'
  assert.equal(context.isActiveSubscriber, false)
  assert.equal(context.workspaceAccessForFlags, false)
  assert.equal(landingCtaLabel, 'View pricing')
})

test('authenticated resolving stale active profile cannot grant workspace access', () => {
  const staleActive = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolving',
    subscriptionStatus: 'active',
    userProfile: { subscription_status: 'active' },
  })

  assert.equal(staleActive.isAccessAuthoritative, false)
  assert.equal(staleActive.hasAuthoritativeAuthenticatedAccess, false)
  assert.equal(staleActive.isActiveSubscriber, false)
  assert.equal(staleActive.canViewUpgradePricing, false)
  assert.equal(staleActive.workspaceAccessForFlags, false)
})

test('authenticated resolved active and trialing profiles grant workspace access', () => {
  for (const status of ['active', 'trialing']) {
    const context = buildResolvedAccessContext({
      isAuthenticated: true,
      accessResolutionStatus: 'resolved',
      subscriptionStatus: status,
      userProfile: { subscription_status: status },
    })

    assert.equal(context.hasAuthoritativeAuthenticatedAccess, true)
    assert.equal(context.isActiveSubscriber, true)
    assert.equal(context.workspaceAccessForFlags, true)
    assert.equal(context.canViewUpgradePricing, false)
  }
})

test('authenticated resolved paid-through cancellation grants workspace access', () => {
  const authoritativeContext = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'canceled',
    userProfile: {
      subscription_status: 'canceled',
      currentPeriodEnd: FUTURE_END,
      cancelAtPeriodEnd: true,
    },
  })

  assert.equal(authoritativeContext.profileBillingState.canAccessProductDashboard, true)
  assert.equal(authoritativeContext.hasAuthoritativeAuthenticatedAccess, true)
  assert.equal(authoritativeContext.isActiveSubscriber, true)
  assert.equal(authoritativeContext.workspaceAccessForFlags, true)
  assert.equal(authoritativeContext.canViewUpgradePricing, false)
})

test('authenticated resolved inactive profile remains upgrade eligible without workspace access', () => {
  const inactive = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'inactive',
    userProfile: { subscription_status: 'inactive' },
  })

  assert.equal(inactive.hasAuthoritativeAuthenticatedAccess, true)
  assert.equal(inactive.isActiveSubscriber, false)
  assert.equal(inactive.workspaceAccessForFlags, false)
  assert.equal(inactive.canViewUpgradePricing, true)
})

test('authenticated resolved inactive profile with history gets read-only state without paid mutation access', () => {
  const inactiveWithHistory = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'inactive',
    userProfile: { subscription_status: 'inactive', hasHistoricalData: true },
  })

  assert.equal(inactiveWithHistory.profileBillingState.isReadOnlyWorkspace, true)
  assert.equal(inactiveWithHistory.profileBillingState.canUsePaidMutation, false)
  assert.equal(inactiveWithHistory.workspaceAccessForFlags, false)
  assert.equal(inactiveWithHistory.canViewUpgradePricing, true)
})
