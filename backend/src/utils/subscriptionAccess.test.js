import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canUsePaidMutation,
  hasActivePaidAccess,
  hasScheduledCancellationAccess,
  isReadOnlyWorkspaceAccess,
} from './subscriptionAccess.js'

const NOW = new Date('2026-07-12T00:00:00Z')
const FUTURE = '2027-01-07T00:00:00Z'
const PAST = '2025-01-07T00:00:00Z'

test('read-only access helper keeps active subscribers full access only', () => {
  const user = { subscription_status: 'active' }

  assert.equal(hasActivePaidAccess(user, NOW), true)
  assert.equal(canUsePaidMutation(user, NOW), true)
  assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), false)
})

test('read-only access helper preserves trial and trialing paid mutation access', () => {
  for (const status of ['trialing', 'trial']) {
    const user = { subscription_status: status }

    assert.equal(hasActivePaidAccess(user, NOW), true, `${status} keeps paid access`)
    assert.equal(canUsePaidMutation(user, NOW), true, `${status} keeps paid mutation access`)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), false, `${status} is not read-only`)
  }
})

test('read-only access helper keeps future scheduled cancellation full access', () => {
  const user = { subscription_status: 'cancelled', cancellation_effective_at: FUTURE }

  assert.equal(hasScheduledCancellationAccess(user, NOW), true)
  assert.equal(hasActivePaidAccess(user, NOW), true)
  assert.equal(canUsePaidMutation(user, NOW), true)
  assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), false)
})

test('read-only access helper requires historical data after cancellation access ends', () => {
  for (const status of ['canceled', 'cancelled']) {
    const user = { subscription_status: status, cancellation_effective_at: PAST }

    assert.equal(hasActivePaidAccess(user, NOW), false)
    assert.equal(canUsePaidMutation(user, NOW), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: false, now: NOW }), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), true)
  }
})

test('read-only access helper requires historical data for billing interruption states', () => {
  for (const status of ['past_due', 'payment_failed', 'paused']) {
    const user = { subscription_status: status }

    assert.equal(hasActivePaidAccess(user, NOW), false)
    assert.equal(canUsePaidMutation(user, NOW), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: false, now: NOW }), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), true)
  }
})

test('read-only access helper requires historical data for inactive and no-subscription states', () => {
  for (const status of ['inactive', 'no_subscription', 'none', 'free', '']) {
    const user = { subscription_status: status }

    assert.equal(hasActivePaidAccess(user, NOW), false)
    assert.equal(canUsePaidMutation(user, NOW), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: false, now: NOW }), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), true)
  }
})

test('unknown or missing subscription never gains paid mutation or read-only access', () => {
  for (const user of [null, undefined, { subscription_status: 'mystery_state' }]) {
    assert.equal(hasActivePaidAccess(user, NOW), false)
    assert.equal(canUsePaidMutation(user, NOW), false)
    assert.equal(isReadOnlyWorkspaceAccess(user, { hasHistoricalData: true, now: NOW }), false)
  }
})
