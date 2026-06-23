import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePaddleCheckoutPlan } from './paddleCheckout.js'

function paddle(overrides = {}) {
  return {
    priceIdsByPlan: {
      monthly: 'pri_monthly',
      annual: 'pri_annual',
      ...overrides.priceIdsByPlan,
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
    { ok: true, priceId: 'pri_monthly' },
  )
  assert.deepEqual(
    validatePaddleCheckoutPlan({ plan: 'annual', paddle: paddle() }),
    { ok: true, priceId: 'pri_annual' },
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
    { ok: true, priceId: 'pri_test' },
  )
})
