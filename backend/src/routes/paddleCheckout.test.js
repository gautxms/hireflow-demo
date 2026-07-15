import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getCheckoutBlockReason,
  isTrialEligibleForUser,
  validatePaddleCheckoutPlan,
} from './paddleCheckout.js'

function paddle(overrides = {}) {
  return {
    priceIdsByPlan: {
      monthly: 'pri_monthly',
      annual: 'pri_annual',
      ...overrides.priceIdsByPlan,
    },
    noTrialPriceIdsByPlan: {
      monthly: 'pri_monthly_paid',
      annual: 'pri_annual_paid',
      ...overrides.noTrialPriceIdsByPlan,
    },
    testCheckout: {
      enabled: false,
      key: undefined,
      ...overrides.testCheckout,
    },
  }
}

test('validatePaddleCheckoutPlan preserves monthly and annual price selection', () => {
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'monthly', paddle: paddle() }),
    { ok: true, priceId: 'pri_monthly', storedPlan: 'monthly', trialEligible: true, checkoutMode: 'trial' },
  )
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'annual', paddle: paddle() }),
    { ok: true, priceId: 'pri_annual', storedPlan: 'annual', trialEligible: true, checkoutMode: 'trial' },
  )
})

test('validatePaddleCheckoutPlan hides test-monthly when disabled or missing price', () => {
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'test-monthly', testKey: 'secret', paddle: paddle() }),
    { ok: false, status: 404, error: 'Checkout is unavailable' },
  )
  assert.deepEqual(
    validatePaddleCheckoutPlan({
      plan: 'test-monthly',
      testKey: 'secret',
      paddle: paddle({ testCheckout: { enabled: true, key: 'secret' }, priceIdsByPlan: { 'test-monthly': undefined } }),
    }),
    { ok: false, status: 404, error: 'Checkout is unavailable' },
  )
})

test('validatePaddleCheckoutPlan requires matching key for test-monthly', () => {
  const configured = paddle({
    priceIdsByPlan: { 'test-monthly': 'pri_test' },
    testCheckout: { enabled: true, key: 'secret' },
  })

  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'test-monthly', testKey: undefined, paddle: configured }),
    { ok: false, status: 403, error: 'Checkout is unavailable' },
  )
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'test-monthly', testKey: 'wrong', paddle: configured }),
    { ok: false, status: 403, error: 'Checkout is unavailable' },
  )
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'test-monthly', testKey: 'secret', paddle: configured }),
    { ok: true, priceId: 'pri_test', storedPlan: 'monthly', trialEligible: false, checkoutMode: 'test' },
  )
})

test('returning subscribers use dedicated no-trial prices', () => {
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'monthly', paddle: paddle(), trialEligible: false }),
    { ok: true, priceId: 'pri_monthly_paid', storedPlan: 'monthly', trialEligible: false, checkoutMode: 'paid_returning' },
  )

  assert.deepEqual(
    validatePaddleCheckoutPlan({
      plan: 'annual',
      paddle: paddle({ noTrialPriceIdsByPlan: { annual: undefined } }),
      trialEligible: false,
    }),
    { ok: false, status: 503, error: 'Checkout for returning subscribers is not configured. Please contact support.' },
  )
})

test('trial eligibility is consumed permanently by any prior subscription signal', () => {
  assert.equal(isTrialEligibleForUser({}), true)
  assert.equal(isTrialEligibleForUser({ trial_consumed_at: '2026-01-01' }), false)
  assert.equal(isTrialEligibleForUser({ trial_ends_at: '2026-01-08' }), false)
  assert.equal(isTrialEligibleForUser({ subscription_started_at: '2026-01-01' }), false)
  assert.equal(isTrialEligibleForUser({ paddle_subscription_id: 'sub_previous' }), false)
  assert.equal(isTrialEligibleForUser({ subscription_status: 'payment_failed' }), false)
  assert.equal(isTrialEligibleForUser({ subscription_status: 'cancelled' }), false)
  assert.equal(isTrialEligibleForUser({ subscription_status: 'inactive', has_payment_attempts: true }), false)
})

test('checkout blocks active, payment-recovery, paused, and scheduled-cancellation states', () => {
  assert.deepEqual(getCheckoutBlockReason({ subscription_status: 'active' }), { reason: 'existing_subscription', redirectTo: '/billing' })
  assert.equal(getCheckoutBlockReason({ subscription_status: 'past_due' }), null, 'subscriptionless payment failure may start a new paid checkout')
  assert.deepEqual(getCheckoutBlockReason({ subscription_status: 'past_due', paddle_subscription_id: 'sub_due' }), { reason: 'payment_required', redirectTo: '/account/payment-method' })
  assert.deepEqual(getCheckoutBlockReason({ subscription_status: 'paused' }), { reason: 'existing_subscription', redirectTo: '/billing' })
  assert.deepEqual(
    getCheckoutBlockReason({ subscription_status: 'cancelled', cancellation_effective_at: '2027-01-01' }, null, new Date('2026-01-01')),
    { reason: 'cancellation_scheduled', redirectTo: '/billing' },
  )
  assert.equal(getCheckoutBlockReason({ subscription_status: 'cancelled', cancellation_effective_at: '2025-01-01' }, { status: 'canceled' }, new Date('2026-01-01')), null)
})
