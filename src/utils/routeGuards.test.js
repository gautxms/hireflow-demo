import test from 'node:test'
import assert from 'node:assert/strict'
import { guardSubscriptionRoute } from './routeGuards.js'

test('subscription route guard honors scheduled-cancellation paid access state', () => {
  let upgradeRequired = false
  const canAccess = guardSubscriptionRoute({
    isAuthenticated: true,
    subscriptionStatus: 'canceled',
    subscriptionState: {
      status: 'canceled',
      cancellationEffectiveAt: '2027-01-07T00:00:00Z',
    },
    onRequireAuth: () => assert.fail('authenticated users should not hit auth guard'),
    onRequireUpgrade: () => {
      upgradeRequired = true
    },
  })

  assert.equal(canAccess, true)
  assert.equal(upgradeRequired, false)
})

test('subscription route guard still upgrades expired canceled subscriptions', () => {
  let upgradeRequired = false
  const canAccess = guardSubscriptionRoute({
    isAuthenticated: true,
    subscriptionStatus: 'canceled',
    subscriptionState: {
      status: 'canceled',
      cancellationEffectiveAt: '2025-01-07T00:00:00Z',
    },
    onRequireAuth: () => assert.fail('authenticated users should not hit auth guard'),
    onRequireUpgrade: () => {
      upgradeRequired = true
    },
  })

  assert.equal(canAccess, false)
  assert.equal(upgradeRequired, true)
})
