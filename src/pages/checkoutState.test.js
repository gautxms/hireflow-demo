import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCheckoutCloseState } from './checkoutState.js'

test('checkout close state: success', () => {
  const state = resolveCheckoutCloseState({ isActiveSubscription: true, verificationFailed: false })
  assert.equal(state.nextStatus, 'success')
  assert.equal(state.shouldShowRetry, false)
})

test('checkout close state: cancelled', () => {
  const state = resolveCheckoutCloseState({ isActiveSubscription: false, verificationFailed: false })
  assert.equal(state.nextStatus, 'cancelled')
  assert.equal(state.shouldShowRetry, true)
})

test('checkout close state: verification failure', () => {
  const state = resolveCheckoutCloseState({ isActiveSubscription: false, verificationFailed: true })
  assert.equal(state.nextStatus, 'retry')
  assert.equal(state.shouldShowRetry, true)
})
