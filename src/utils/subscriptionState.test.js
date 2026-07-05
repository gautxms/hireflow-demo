import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSubscriptionState, hasActiveSubscription, canAccessProductDashboard, canRenderBillingPage } from './subscriptionState.js'

test('free users cannot manage billing or access product dashboard', () => {
  const state = resolveSubscriptionState({ user: { subscription_status: 'inactive' } })

  assert.equal(state.planLabel, 'Free plan')
  assert.equal(state.statusLabel, 'Free plan / No active subscription')
  assert.equal(state.canManageBilling, false)
  assert.equal(canRenderBillingPage(state), false)
  assert.equal(state.canAccessProductDashboard, false)
})

test('active users require Paddle customer and subscription identifiers to manage billing', () => {
  const missingProviderState = resolveSubscriptionState({ subscription: { status: 'active', plan: 'monthly' } })
  const providerReadyState = resolveSubscriptionState({
    subscription: {
      status: 'active',
      plan: 'monthly',
      paddleCustomerId: 'ctm_123',
      paddleSubscriptionId: 'sub_123',
    },
  })

  assert.equal(missingProviderState.canManageBilling, false)
  assert.equal(providerReadyState.canManageBilling, true)
  assert.equal(canRenderBillingPage(providerReadyState), true)
  assert.equal(providerReadyState.canAccessProductDashboard, true)
})

test('trialing users keep product access without being labeled inactive', () => {
  const state = resolveSubscriptionState({ subscription: { status: 'trialing', plan: 'monthly' } })

  assert.equal(state.statusLabel, 'Trialing')
  assert.equal(hasActiveSubscription('trialing'), true)
  assert.equal(canAccessProductDashboard('trialing'), true)
})

test('past due users are payment issue states, not free states', () => {
  const state = resolveSubscriptionState({
    subscription: {
      status: 'past_due',
      plan: 'monthly',
      paddleCustomerId: 'ctm_123',
      paddleSubscriptionId: 'sub_123',
    },
  })

  assert.equal(state.statusLabel, 'Past due')
  assert.equal(state.canAccessProductDashboard, false)
  assert.equal(state.canManageBilling, true)
})

test('billing page rendering requires management access or valid Paddle billing state', () => {
  const freeWithCustomerOnly = resolveSubscriptionState({
    subscription: { status: 'inactive', paddleCustomerId: 'ctm_123' },
  })
  const canceledProviderState = resolveSubscriptionState({
    subscription: { status: 'canceled', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' },
  })

  assert.equal(canRenderBillingPage(freeWithCustomerOnly), false)
  assert.equal(canRenderBillingPage(canceledProviderState), true)
})

test('scheduled cancellation keeps paid mutation access until effective date', () => {
  const state = resolveSubscriptionState({
    subscription: {
      status: 'canceled',
      plan: 'annual',
      paddleCustomerId: 'ctm_123',
      paddleSubscriptionId: 'sub_123',
      cancellationEffectiveAt: '2027-01-07T00:00:00Z',
    },
  })

  assert.equal(state.hasScheduledCancellationAccess, true)
  assert.equal(state.hasActivePaidAccess, true)
  assert.equal(state.canUsePaidMutation, true)
  assert.equal(state.isReadOnlyExpiredSubscriber, false)
})

test('expired canceled subscriptions are read-only and cannot use paid mutations', () => {
  const state = resolveSubscriptionState({
    subscription: {
      status: 'canceled',
      plan: 'annual',
      paddleCustomerId: 'ctm_123',
      paddleSubscriptionId: 'sub_123',
      cancellationEffectiveAt: '2025-01-07T00:00:00Z',
    },
  })

  assert.equal(state.hasScheduledCancellationAccess, false)
  assert.equal(state.hasActivePaidAccess, false)
  assert.equal(state.canUsePaidMutation, false)
  assert.equal(state.isReadOnlyExpiredSubscriber, true)
  assert.equal(canRenderBillingPage(state), true)
})

test('product route access allows active, trialing, and future scheduled cancellation states', () => {
  assert.equal(canAccessProductDashboard('active'), true)
  assert.equal(canAccessProductDashboard('trialing'), true)
  assert.equal(canAccessProductDashboard({ status: 'cancelled', cancellationEffectiveAt: '2099-01-07T00:00:00Z' }), true)
})

test('product route access blocks expired canceled users while billing remains renderable', () => {
  const expiredState = resolveSubscriptionState({
    subscription: {
      status: 'cancelled',
      paddleCustomerId: 'ctm_123',
      paddleSubscriptionId: 'sub_123',
      cancellationEffectiveAt: '2025-01-07T00:00:00Z',
    },
  })

  assert.equal(canAccessProductDashboard(expiredState), false)
  assert.equal(expiredState.isReadOnlyExpiredSubscriber, true)
  assert.equal(canRenderBillingPage(expiredState), true)
})
