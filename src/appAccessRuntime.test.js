import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResolvedAccessContext } from './appAccessRuntime.js'

test('access context waits for authoritative sync before granting scheduled cancellation workspace access', () => {
  const loginContext = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolving',
    subscriptionStatus: 'canceled',
    userProfile: { subscription_status: 'canceled' },
  })

  assert.equal(loginContext.isAccessAuthoritative, false)
  assert.equal(loginContext.isActiveSubscriber, false)
  assert.equal(loginContext.workspaceAccessForFlags, false)
  assert.equal(loginContext.canViewUpgradePricing, false)

  const authoritativeContext = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'canceled',
    userProfile: {
      subscription_status: 'canceled',
      currentPeriodEnd: '2999-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
    },
  })

  assert.equal(authoritativeContext.profileBillingState.canAccessProductDashboard, true)
  assert.equal(authoritativeContext.isActiveSubscriber, true)
  assert.equal(authoritativeContext.workspaceAccessForFlags, true)
  assert.equal(authoritativeContext.canViewUpgradePricing, false)
})

test('access context prevents stale cache from driving public shell CTAs while resolving', () => {
  const staleActive = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolving',
    subscriptionStatus: 'active',
    userProfile: { subscription_status: 'active' },
  })

  assert.equal(staleActive.isActiveSubscriber, false)
  assert.equal(staleActive.canViewUpgradePricing, false)
  assert.equal(staleActive.workspaceAccessForFlags, false)
})

test('access context reflects inactive account only after resolution', () => {
  const inactive = buildResolvedAccessContext({
    isAuthenticated: true,
    accessResolutionStatus: 'resolved',
    subscriptionStatus: 'inactive',
    userProfile: { subscription_status: 'inactive' },
  })

  assert.equal(inactive.isActiveSubscriber, false)
  assert.equal(inactive.canViewUpgradePricing, true)
})
