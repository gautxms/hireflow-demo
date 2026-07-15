import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canAccessProductDashboard,
  canRenderBillingPage,
  hasActiveSubscription,
  getFutureSubscriptionEndDate,
  hasScheduledCancellationAccess,
  canUsePaidMutation,
  isReadOnlyWorkspace,
  resolveSubscriptionState,
} from './subscriptionState.js'

const NOW = new Date('2026-07-12T00:00:00Z')
const FUTURE = '2027-01-07T00:00:00Z'
const PAST = '2025-01-07T00:00:00Z'

function state(subscription) {
  return resolveSubscriptionState({ subscription, now: NOW })
}

test('active renewing subscription keeps active paid access without cancellation scheduling', () => {
  const resolved = state({ status: 'active', plan: 'monthly', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' })

  assert.equal(resolved.statusLabel, 'Active')
  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.canAccessProductDashboard, true)
  assert.equal(resolved.isCancellationScheduled, false)
  assert.equal(resolved.cancelAtPeriodEnd, false)
  assert.equal(resolved.canManageBilling, true)
  assert.equal(canRenderBillingPage(resolved), true)
})

test('trialing subscription keeps product access without being labeled inactive', () => {
  const resolved = state({ status: 'trialing', plan: 'monthly' })

  assert.equal(resolved.statusLabel, 'Trialing')
  assert.equal(hasActiveSubscription('trialing'), true)
  assert.equal(canAccessProductDashboard(resolved, NOW), true)
})

test('canceled subscription with future cancellationEffectiveAt has scheduled cancellation paid access', () => {
  const resolved = state({ status: 'canceled', plan: 'annual', cancellationEffectiveAt: FUTURE })

  assert.equal(resolved.statusLabel, 'Cancellation scheduled')
  assert.equal(resolved.isCancellationScheduled, true)
  assert.equal(resolved.hasScheduledCancellationAccess, true)
  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.accessEndsAt, '2027-01-07T00:00:00.000Z')
})

test('cancelled subscription with future currentPeriodEnd uses it only as access end date', () => {
  const resolved = state({ status: 'cancelled', plan: 'annual', currentPeriodEnd: FUTURE })

  assert.equal(resolved.isCancellationScheduled, true)
  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.paidThroughDate, '2027-01-07T00:00:00.000Z')
})

test('active subscription with cancelAtPeriodEnd and future cancellationEffectiveAt is scheduled', () => {
  const resolved = state({ status: 'active', plan: 'annual', cancelAtPeriodEnd: true, cancellationEffectiveAt: FUTURE })

  assert.equal(resolved.statusLabel, 'Cancellation scheduled')
  assert.equal(resolved.cancelAtPeriodEnd, true)
  assert.equal(resolved.canAccessProductDashboard, true)
})

test('active subscription with cancel_at_period_end and future currentPeriodEnd is scheduled', () => {
  const resolved = state({ status: 'active', plan: 'annual', cancel_at_period_end: true, currentPeriodEnd: FUTURE })

  assert.equal(resolved.statusLabel, 'Cancellation scheduled')
  assert.equal(resolved.cancelAtPeriodEnd, true)
  assert.equal(resolved.hasScheduledCancellationAccess, true)
})

test('active subscription with latestRecordStatus cancellation_scheduled and future date is scheduled', () => {
  const resolved = state({ status: 'active', latestRecordStatus: 'cancellation_scheduled', accessEndsAt: FUTURE })

  assert.equal(resolved.statusLabel, 'Cancellation scheduled')
  assert.equal(resolved.hasActivePaidAccess, true)
})

test('recognized scheduled status with future date is scheduled', () => {
  const resolved = state({ status: 'cancellation_scheduled', paidThroughDate: FUTURE })

  assert.equal(resolved.statusLabel, 'Cancellation scheduled')
  assert.equal(resolved.hasScheduledCancellationAccess, true)
  assert.equal(hasScheduledCancellationAccess({ status: 'pending_cancellation', paidThroughDate: FUTURE }, NOW), true)
})

test('future date selection skips malformed cancellationEffectiveAt and falls through to currentPeriodEnd', () => {
  const endDate = getFutureSubscriptionEndDate({ cancellationEffectiveAt: 'not-a-date', currentPeriodEnd: FUTURE }, NOW)

  assert.equal(endDate.toISOString(), '2027-01-07T00:00:00.000Z')
})

test('future date selection skips past cancellationEffectiveAt and falls through to currentPeriodEnd', () => {
  const endDate = getFutureSubscriptionEndDate({ cancellationEffectiveAt: PAST, currentPeriodEnd: FUTURE }, NOW)

  assert.equal(endDate.toISOString(), '2027-01-07T00:00:00.000Z')
})

test('future date selection skips several invalid candidates before valid paidThroughDate', () => {
  const endDate = getFutureSubscriptionEndDate({
    cancellationEffectiveAt: 'bad',
    cancellation_effective_at: PAST,
    accessEndsAt: '',
    access_ends_at: 'also-bad',
    paidThroughDate: FUTURE,
    currentPeriodEnd: '2028-01-07T00:00:00Z',
  }, NOW)

  assert.equal(endDate.toISOString(), '2027-01-07T00:00:00.000Z')
})

test('future date selection returns null when all candidates are invalid or past', () => {
  const endDate = getFutureSubscriptionEndDate({
    cancellationEffectiveAt: 'bad',
    cancellation_effective_at: PAST,
    accessEndsAt: '',
    paidThroughDate: '2020-01-07T00:00:00Z',
    currentPeriodEnd: 'not-a-date',
  }, NOW)

  assert.equal(endDate, null)
})

test('active subscription with future currentPeriodEnd only is not scheduled cancellation', () => {
  const resolved = state({ status: 'active', currentPeriodEnd: FUTURE })

  assert.equal(resolved.statusLabel, 'Active')
  assert.equal(resolved.isCancellationScheduled, false)
  assert.equal(resolved.hasActivePaidAccess, true)
})

test('active subscription with stale future cancellationEffectiveAt but no signal is not scheduled', () => {
  const resolved = state({ status: 'active', cancellationEffectiveAt: FUTURE, latestRecordStatus: 'active' })

  assert.equal(resolved.statusLabel, 'Active')
  assert.equal(resolved.isCancellationScheduled, false)
  assert.equal(resolved.cancelAtPeriodEnd, false)
})

test('active subscription with cancelAtPeriodEnd and missing date is not read-only expired', () => {
  const resolved = state({ status: 'active', cancelAtPeriodEnd: true })

  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.isReadOnlyExpiredSubscriber, false)
  assert.equal(resolved.isCancellationScheduled, false)
})

test('active subscription with cancelAtPeriodEnd and past date is not read-only expired', () => {
  const resolved = state({ status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: PAST })

  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.isReadOnlyExpiredSubscriber, false)
  assert.equal(resolved.isCancellationScheduled, false)
})

test('trialing subscription with cancellation signal and missing date is not read-only expired', () => {
  const resolved = state({ status: 'trialing', cancelAtPeriodEnd: true })

  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.isReadOnlyExpiredSubscriber, false)
  assert.equal(resolved.statusLabel, 'Trialing')
})

test('cancellation signal is exposed independently from scheduled access', () => {
  const resolved = state({ status: 'active', cancelAtPeriodEnd: true })

  assert.equal(resolved.hasCancellationSignal, true)
  assert.equal(resolved.isCancellationScheduled, false)
  assert.equal(resolved.hasScheduledCancellationAccess, false)
})

test('active paid access and read-only expired are never simultaneously true', () => {
  const cases = [
    state({ status: 'active', cancelAtPeriodEnd: true }),
    state({ status: 'trialing', cancelAtPeriodEnd: true }),
    state({ status: 'canceled', cancellationEffectiveAt: FUTURE }),
    state({ status: 'canceled', cancellationEffectiveAt: PAST }),
    state({ status: 'scheduled_cancellation' }),
  ]

  for (const resolved of cases) {
    assert.equal(resolved.hasActivePaidAccess && resolved.isReadOnlyExpiredSubscriber, false)
  }
})

test('canceled subscription with past effective date is expired and loses paid access', () => {
  const resolved = state({ status: 'canceled', plan: 'annual', cancellationEffectiveAt: PAST })

  assert.equal(resolved.statusLabel, 'Canceled')
  assert.equal(resolved.hasScheduledCancellationAccess, false)
  assert.equal(resolved.hasActivePaidAccess, false)
  assert.equal(resolved.canUsePaidMutation, false)
  assert.equal(resolved.isReadOnlyExpiredSubscriber, true)
})

test('scheduled status with missing access-end date is not scheduled access', () => {
  const resolved = state({ status: 'scheduled_cancellation' })

  assert.equal(resolved.hasScheduledCancellationAccess, false)
  assert.equal(resolved.hasActivePaidAccess, false)
  assert.equal(resolved.isReadOnlyExpiredSubscriber, true)
})

test('malformed cancellation date is ignored', () => {
  const resolved = state({ status: 'canceled', cancellationEffectiveAt: 'not-a-date' })

  assert.equal(resolved.hasScheduledCancellationAccess, false)
  assert.equal(resolved.hasActivePaidAccess, false)
})

test('free and inactive users have no active subscription or scheduled access', () => {
  const resolved = resolveSubscriptionState({ user: { subscription_status: 'inactive', currentPeriodEnd: FUTURE, cancelAtPeriodEnd: true }, now: NOW })

  assert.equal(resolved.planLabel, 'No active subscription')
  assert.equal(resolved.statusLabel, 'No active subscription')
  assert.equal(resolved.canManageBilling, false)
  assert.equal(canRenderBillingPage(resolved), false)
  assert.equal(resolved.hasScheduledCancellationAccess, false)
  assert.equal(resolved.canAccessProductDashboard, false)
})

test('past due users are payment issue states without product dashboard access', () => {
  const resolved = state({ status: 'past_due', plan: 'monthly', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' })

  assert.equal(resolved.statusLabel, 'Past due')
  assert.equal(resolved.canAccessProductDashboard, false)
  assert.equal(resolved.canManageBilling, true)
})

test('payment_failed users are past-due manageable billing states without product dashboard access', () => {
  const resolved = state({ status: 'payment_failed', plan: 'monthly', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' })

  assert.equal(resolved.statusLabel, 'Past due')
  assert.equal(resolved.isPastDue, true)
  assert.equal(resolved.canAccessProductDashboard, false)
  assert.equal(resolved.canManageBilling, true)
  assert.equal(canRenderBillingPage(resolved), true)
})

test('paused users are provider-managed billing states without dashboard access', () => {
  const resolved = state({ status: 'paused', plan: 'monthly', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' })

  assert.equal(resolved.statusLabel, 'Paused')
  assert.equal(resolved.canAccessProductDashboard, false)
  assert.equal(resolved.canManageBilling, true)
})

test('trial alias and scheduled statuses with provider IDs can manage billing', () => {
  for (const status of ['trial', 'cancellation_scheduled', 'cancel_scheduled', 'pending_cancellation', 'scheduled_cancellation']) {
    const resolved = state({ status, paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123', currentPeriodEnd: FUTURE })
    assert.equal(resolved.canManageBilling, true)
  }
})

test('billing page rendering requires management access or valid provider billing state', () => {
  const freeWithCustomerOnly = state({ status: 'inactive', paddleCustomerId: 'ctm_123' })
  const canceledProviderState = state({ status: 'canceled', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' })

  assert.equal(canRenderBillingPage(freeWithCustomerOnly), false)
  assert.equal(canRenderBillingPage(canceledProviderState), true)
})

test('read-only workspace helper keeps active users full access only', () => {
  const resolved = state({ status: 'active', plan: 'monthly', hasHistoricalData: true })

  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.canUsePaidMutation, true)
  assert.equal(resolved.canAccessProductDashboard, true)
  assert.equal(resolved.isReadOnlyWorkspace, false)
  assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: true, now: NOW }), false)
})

test('read-only workspace helper preserves trial and trialing full-access behavior', () => {
  for (const status of ['trialing', 'trial']) {
    const resolved = state({ status, hasHistoricalData: true })

    assert.equal(resolved.hasActivePaidAccess, true, `${status} keeps full access`)
    assert.equal(canUsePaidMutation(resolved, NOW), true, `${status} keeps paid mutation access`)
    assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: true, now: NOW }), false, `${status} is not read-only`)
  }
})

test('read-only workspace helper keeps future scheduled cancellation full access', () => {
  const resolved = state({ status: 'cancelled', cancellationEffectiveAt: FUTURE, hasHistoricalData: true })

  assert.equal(resolved.hasScheduledCancellationAccess, true)
  assert.equal(resolved.hasActivePaidAccess, true)
  assert.equal(resolved.canUsePaidMutation, true)
  assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: true, now: NOW }), false)
})

test('read-only workspace helper requires historical data after cancellation access ends', () => {
  const expired = state({ status: 'cancelled', cancellationEffectiveAt: PAST })

  assert.equal(expired.hasActivePaidAccess, false)
  assert.equal(expired.canUsePaidMutation, false)
  assert.equal(isReadOnlyWorkspace(expired, { hasHistoricalData: false, now: NOW }), false)
  assert.equal(isReadOnlyWorkspace(expired, { hasHistoricalData: true, now: NOW }), true)
})

test('read-only workspace helper requires historical data for billing failure states', () => {
  for (const status of ['past_due', 'payment_failed', 'paused']) {
    const resolved = state({ status })

    assert.equal(resolved.hasActivePaidAccess, false)
    assert.equal(resolved.canUsePaidMutation, false)
    assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: false, now: NOW }), false)
    assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: true, now: NOW }), true)
  }
})

test('read-only workspace helper requires historical data for inactive and ended subscription states', () => {
  for (const status of ['inactive', 'canceled', 'cancelled']) {
    const resolved = state({ status })

    assert.equal(resolved.hasActivePaidAccess, false)
    assert.equal(resolved.canUsePaidMutation, false)
    assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: false, now: NOW }), false)
    assert.equal(isReadOnlyWorkspace(resolved, { hasHistoricalData: true, now: NOW }), true)
  }
})

test('unknown and missing subscription states do not accidentally gain paid or read-only access', () => {
  for (const input of [null, undefined, { status: 'mystery_state' }]) {
    assert.equal(canAccessProductDashboard(input, NOW), false)
    assert.equal(canUsePaidMutation(input, NOW), false)
    assert.equal(isReadOnlyWorkspace(input, { hasHistoricalData: true, now: NOW }), false)
  }
})
