import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getCheckoutBlockReason,
  isTrialEligibleForUser,
  persistVerifiedCheckoutSubscription,
  selectReturningCheckoutTransaction,
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

test('selectReturningCheckoutTransaction only selects a completed paid returning checkout for the same user and environment', () => {
  const user = { id: 42, paddle_customer_id: 'ctm_123' }
  const paddleConfig = { environment: 'sandbox' }
  const transactions = [
    {
      id: 'txn_trial',
      status: 'completed',
      customer_id: 'ctm_123',
      subscription_id: 'sub_trial',
      custom_data: { userId: 42, paddleEnvironment: 'sandbox', trialEligible: true, checkoutMode: 'trial' },
    },
    {
      id: 'txn_other_user',
      status: 'completed',
      customer_id: 'ctm_123',
      subscription_id: 'sub_other',
      custom_data: { userId: 99, paddleEnvironment: 'sandbox', trialEligible: false, checkoutMode: 'paid_returning' },
    },
    {
      id: 'txn_returning',
      status: 'completed',
      customer_id: 'ctm_123',
      subscription_id: 'sub_new',
      custom_data: { userId: 42, paddleEnvironment: 'sandbox', trialEligible: false, checkoutMode: 'paid_returning' },
    },
  ]

  assert.equal(selectReturningCheckoutTransaction(transactions, user, paddleConfig)?.id, 'txn_returning')
})

test('persistVerifiedCheckoutSubscription replaces a cancelled Annual lifecycle with the verified new Monthly subscription', async () => {
  const calls = []
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params })
      if (/UPDATE users/.test(sql)) return { rowCount: 1, rows: [{ id: 42 }] }
      return { rowCount: 1, rows: [] }
    },
  }
  const result = await persistVerifiedCheckoutSubscription({
    client,
    user: {
      id: 42,
      subscription_status: 'cancelled',
      subscription_plan: 'annual',
      cancellation_effective_at: '2026-07-23T00:00:00.000Z',
      paddle_customer_id: 'ctm_123',
      paddle_subscription_id: 'sub_old_annual',
    },
    transaction: {
      id: 'txn_monthly',
      status: 'completed',
      customer_id: 'ctm_123',
      subscription_id: 'sub_new_monthly',
      custom_data: { userId: 42, paddleEnvironment: 'sandbox', checkoutMode: 'paid_returning' },
    },
    subscription: {
      id: 'sub_new_monthly',
      status: 'active',
      customer_id: 'ctm_123',
      items: [{ price: { id: 'pri_monthly_paid' } }],
      current_billing_period: {
        starts_at: '2026-07-23T00:00:00.000Z',
        ends_at: '2026-08-23T00:00:00.000Z',
      },
      next_billed_at: '2026-08-23T00:00:00.000Z',
    },
    paddle: {
      environment: 'sandbox',
      priceIdsByPlan: { monthly: 'pri_monthly', annual: 'pri_annual' },
      noTrialPriceIdsByPlan: { monthly: 'pri_monthly_paid', annual: 'pri_annual_paid' },
    },
    now: new Date('2026-07-24T00:00:00.000Z'),
  })

  assert.deepEqual(result, {
    synced: true,
    status: 'active',
    plan: 'monthly',
    subscriptionId: 'sub_new_monthly',
    transactionId: 'txn_monthly',
  })
  const update = calls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.equal(update.params[2], 'monthly')
  assert.equal(update.params[3], 'sub_new_monthly')
  assert.match(update.sql, /cancellation_effective_at = NULL/)
  assert.match(update.sql, /cancellation_reason = NULL/)
  assert.equal(calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)), true)
  assert.equal(calls.at(-1).sql, 'COMMIT')
})

test('persistVerifiedCheckoutSubscription rejects a different subscription lifecycle for an active user', async () => {
  let queryCount = 0
  const result = await persistVerifiedCheckoutSubscription({
    client: { async query() { queryCount += 1 } },
    user: {
      id: 42,
      subscription_status: 'active',
      paddle_customer_id: 'ctm_123',
      paddle_subscription_id: 'sub_current',
    },
    transaction: {
      id: 'txn_stale',
      status: 'completed',
      customer_id: 'ctm_123',
      subscription_id: 'sub_other',
      custom_data: { userId: 42, paddleEnvironment: 'sandbox', checkoutMode: 'paid_returning' },
    },
    subscription: {
      id: 'sub_other',
      status: 'active',
      customer_id: 'ctm_123',
      items: [{ price: { id: 'pri_monthly' } }],
      current_billing_period: { ends_at: '2026-08-23T00:00:00.000Z' },
      next_billed_at: '2026-08-23T00:00:00.000Z',
    },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_monthly' } },
  })

  assert.equal(result.synced, false)
  assert.equal(result.reason, 'subscription_not_replaceable')
  assert.equal(queryCount, 0)
})

test('persistVerifiedCheckoutSubscription rejects a transaction that belongs to another user', async () => {
  let queryCount = 0
  const result = await persistVerifiedCheckoutSubscription({
    client: { async query() { queryCount += 1 } },
    user: { id: 42, subscription_status: 'cancelled', paddle_customer_id: 'ctm_123' },
    transaction: {
      id: 'txn_other',
      status: 'completed',
      customer_id: 'ctm_123',
      subscription_id: 'sub_other',
      custom_data: { userId: 99, paddleEnvironment: 'sandbox', checkoutMode: 'paid_returning' },
    },
    subscription: {
      id: 'sub_other',
      status: 'active',
      customer_id: 'ctm_123',
    },
    paddle: { environment: 'sandbox' },
  })

  assert.equal(result.synced, false)
  assert.equal(result.reason, 'unverified_checkout')
  assert.equal(queryCount, 0)
})

test('persistVerifiedCheckoutSubscription rejects a recurring transaction that is not a HireFlow checkout', async () => {
  let queryCount = 0
  const result = await persistVerifiedCheckoutSubscription({
    client: { async query() { queryCount += 1 } },
    user: {
      id: 42,
      subscription_status: 'cancelled',
      paddle_customer_id: 'ctm_123',
      paddle_subscription_id: 'sub_old',
    },
    transaction: {
      id: 'txn_recurring',
      status: 'completed',
      origin: 'subscription_recurring',
      customer_id: 'ctm_123',
      subscription_id: 'sub_new',
      custom_data: { userId: 42, paddleEnvironment: 'sandbox' },
    },
    subscription: { id: 'sub_new', status: 'active', customer_id: 'ctm_123' },
    paddle: { environment: 'sandbox' },
  })

  assert.equal(result.synced, false)
  assert.equal(result.reason, 'unverified_checkout')
  assert.equal(queryCount, 0)
})
