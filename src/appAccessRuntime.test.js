import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReadOnlyWorkspaceNotice, buildResolvedAccessContext, canViewHistoricalWorkspaceModule } from './appAccessRuntime.js'

const FUTURE_END = '2999-01-01T00:00:00.000Z'
const READ_ONLY_STATUSES = [
  'past_due',
  'past due',
  'payment_failed',
  'paused',
  'canceled',
  'cancelled',
  'cancel_scheduled',
  'cancellation_scheduled',
  'pending_cancellation',
  'scheduled_cancellation',
  'inactive',
  'no_subscription',
  'none',
  'free',
]

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
  assert.equal(context.canOpenWorkspaceDashboard, false)
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
  assert.equal(context.canOpenWorkspaceDashboard, false)
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

  const landingCtaLabel = context.canOpenWorkspaceDashboard ? 'Dashboard' : 'View pricing'
  assert.equal(context.isActiveSubscriber, false)
  assert.equal(context.canOpenWorkspaceDashboard, false)
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
  assert.equal(staleActive.canOpenWorkspaceDashboard, false)
  assert.equal(staleActive.canViewUpgradePricing, false)
  assert.equal(staleActive.workspaceAccessForFlags, false)
})

test('authenticated resolved active and trialing profiles grant workspace access', () => {
  for (const status of ['active', 'trialing', 'trial']) {
    const context = buildResolvedAccessContext({
      isAuthenticated: true,
      accessResolutionStatus: 'resolved',
      subscriptionStatus: status,
      userProfile: { subscription_status: status },
    })

    assert.equal(context.hasAuthoritativeAuthenticatedAccess, true)
    assert.equal(context.isActiveSubscriber, true)
    assert.equal(context.canOpenWorkspaceDashboard, true)
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
  assert.equal(authoritativeContext.canOpenWorkspaceDashboard, true)
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
  assert.equal(inactive.canOpenWorkspaceDashboard, false)
  assert.equal(inactive.workspaceAccessForFlags, false)
  assert.equal(inactive.canViewUpgradePricing, true)
})

test('authenticated resolved non-paid profiles with history can open the read-only Dashboard', () => {
  for (const status of READ_ONLY_STATUSES) {
    const readOnlyWithHistory = buildResolvedAccessContext({
      isAuthenticated: true,
      accessResolutionStatus: 'resolved',
      subscriptionStatus: status,
      userProfile: { subscription_status: status, hasHistoricalData: true },
    })

    assert.equal(readOnlyWithHistory.profileBillingState.isReadOnlyWorkspace, true, `${status} is read-only`)
    assert.equal(readOnlyWithHistory.profileBillingState.canUsePaidMutation, false, `${status} cannot mutate`)
    assert.equal(readOnlyWithHistory.isActiveSubscriber, false, `${status} is not active`)
    assert.equal(readOnlyWithHistory.canOpenWorkspaceDashboard, true, `${status} can open Dashboard`)
    assert.equal(readOnlyWithHistory.workspaceAccessForFlags, false, `${status} does not gain paid feature flags`)
    assert.equal(readOnlyWithHistory.canViewUpgradePricing, true, `${status} stays upgrade eligible`)
  }
})

test('history-free non-paid profiles remain outside the Dashboard', () => {
  for (const status of READ_ONLY_STATUSES) {
    const historyFree = buildResolvedAccessContext({
      isAuthenticated: true,
      accessResolutionStatus: 'resolved',
      subscriptionStatus: status,
      userProfile: { subscription_status: status, hasHistoricalData: false },
    })

    assert.equal(historyFree.profileBillingState.isReadOnlyWorkspace, false, `${status} requires history`)
    assert.equal(historyFree.canOpenWorkspaceDashboard, false, `${status} cannot open Dashboard without history`)
  }
})

test('read-only history can remain visible when subscription-gated feature flags are off', () => {
  assert.equal(canViewHistoricalWorkspaceModule(false, {
    isReadOnlyWorkspace: true,
    canUsePaidMutation: false,
  }), true)
})

test('historical module visibility does not grant access to inactive accounts without history', () => {
  assert.equal(canViewHistoricalWorkspaceModule(false, {
    isReadOnlyWorkspace: false,
    canUsePaidMutation: false,
  }), false)
})

test('enabled modules remain visible to paid users', () => {
  assert.equal(canViewHistoricalWorkspaceModule(true, {
    isReadOnlyWorkspace: false,
    canUsePaidMutation: true,
  }), true)
})

test('read-only notice sends payment failures to billing with recovery copy', () => {
  assert.deepEqual(buildReadOnlyWorkspaceNotice({
    isReadOnlyWorkspace: true,
    canUsePaidMutation: false,
    isPastDue: true,
  }), {
    title: 'Payment required',
    description: 'Your historical workspace remains available in read-only mode. Review billing to restore recruiting actions.',
    actionLabel: 'Review billing',
    actionPath: '/billing',
  })
})

test('read-only notice sends ended subscriptions to plans', () => {
  assert.deepEqual(buildReadOnlyWorkspaceNotice({
    isReadOnlyWorkspace: true,
    canUsePaidMutation: false,
    isCanceled: true,
  }), {
    title: 'Read-only access',
    description: 'Your historical data remains available. Choose a plan to create analyses or change recruiting workflows.',
    actionLabel: 'View plans',
    actionPath: '/pricing',
  })
})

test('read-only notice sends paused subscriptions to billing', () => {
  assert.deepEqual(buildReadOnlyWorkspaceNotice({
    isReadOnlyWorkspace: true,
    canUsePaidMutation: false,
    isPaused: true,
  }), {
    title: 'Subscription paused',
    description: 'Your historical workspace remains available in read-only mode. Review billing to resume recruiting actions.',
    actionLabel: 'Review billing',
    actionPath: '/billing',
  })
})

test('read-only notice stays absent for paid and history-free accounts', () => {
  assert.equal(buildReadOnlyWorkspaceNotice({ isReadOnlyWorkspace: false, canUsePaidMutation: false }), null)
  assert.equal(buildReadOnlyWorkspaceNotice({ isReadOnlyWorkspace: false, canUsePaidMutation: true }), null)
})
