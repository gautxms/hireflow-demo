import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCheckoutSuccessUrl,
  getCheckoutBlockReason,
  isTrialEligibleForUser,
  loadCheckoutReservationForSync,
  prepareCheckoutSubscriptionState,
  persistVerifiedCheckoutSubscription,
  resolveCheckoutSyncTransactionId,
  selectReturningCheckoutTransaction,
  supersedeCheckoutReservation,
  transactionMatchesCheckoutReservation,
  validatePaddleCheckoutPlan,
} from './paddleCheckout.js'
import { reconcilePaddleSubscriptionState } from '../services/paddleSubscriptionReconciliation.js'
import { markCheckoutReservationCompleted } from '../services/paddleCheckoutReservations.js'

function checkoutReservationFixture() {
  const reservation = {
    id: 'reservation-annual',
    reservation_token: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
    user_id: 42,
    paddle_environment: 'sandbox',
    requested_plan: 'annual',
    stored_plan: 'annual',
    price_id: 'pri_annual_paid',
    trial_eligible: false,
    checkout_mode: 'paid_returning',
    status: 'ready',
    paddle_transaction_id: 'txn_annual123',
    paddle_customer_id: 'ctm_123',
  }
  const user = { id: 42, email: 'returning@example.test', paddle_customer_id: 'ctm_123' }
  const transaction = {
    id: 'txn_annual123',
    status: 'ready',
    customer_id: 'ctm_123',
    subscription_id: null,
    items: [{ price_id: 'pri_annual_paid' }],
    custom_data: {
      userId: 42,
      checkoutReservationId: reservation.reservation_token,
      paddleEnvironment: 'sandbox',
      requestedPlan: 'annual',
      plan: 'annual',
      checkoutMode: 'paid_returning',
      trialEligible: false,
    },
    checkout: { url: 'https://checkout.paddle.test/pay?_ptxn=txn_annual123' },
  }
  return {
    acquisition: {
      action: 'purchase_conflict',
      reservation,
      user,
      purchase: { requestedPlan: 'monthly' },
    },
    transaction,
    paddle: {
      apiBaseUrl: 'https://sandbox-api.paddle.test',
      apiKey: 'sandbox-api-key',
      apiVersion: '1',
      environment: 'sandbox',
    },
  }
}

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

test('completed checkout reservation updates require an exact UUID, account, environment, and transaction', async () => {
  const calls = []
  const db = { async query(sql, params) { calls.push({ sql: String(sql), params }); return { rowCount: 1, rows: [{ id: 'reservation-id' }] } } }
  const result = await markCheckoutReservationCompleted({
    db,
    reservationToken: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
    userId: 42,
    environment: 'sandbox',
    transactionId: 'txn_completed123',
    customerId: 'ctm_123',
  })

  assert.equal(result.rowCount, 1)
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /status = 'completed'/)
  assert.match(calls[0].sql, /user_id = \$2/)
  assert.match(calls[0].sql, /paddle_environment = \$3/)
  assert.match(calls[0].sql, /paddle_transaction_id IS NULL OR paddle_transaction_id = \$4/)

  const rejected = await markCheckoutReservationCompleted({
    db,
    reservationToken: 'not-a-uuid',
    userId: 42,
    environment: 'sandbox',
    transactionId: 'txn_completed123',
  })
  assert.equal(rejected.rowCount, 0)
  assert.equal(calls.length, 1)
})

test('checkout success URL carries the exact reservation and selected plan', () => {
  const url = new URL(buildCheckoutSuccessUrl(
    'https://hireflow.dev',
    { reservation_token: '42d85541-3b0e-4b1a-8dca-2525950fbaf0' },
    { storedPlan: 'annual' },
  ))

  assert.equal(url.origin, 'https://hireflow.dev')
  assert.equal(url.pathname, '/billing/success')
  assert.equal(url.searchParams.get('checkout'), '42d85541-3b0e-4b1a-8dca-2525950fbaf0')
  assert.equal(url.searchParams.get('plan'), 'annual')
})

test('completed checkout sync resolves only the authenticated exact reservation', async () => {
  const calls = []
  const reservation = checkoutReservationFixture().acquisition.reservation
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rowCount: 1, rows: [reservation] }
    },
  }

  const result = await loadCheckoutReservationForSync({
    db,
    reservationToken: reservation.reservation_token,
    userId: 42,
    environment: 'sandbox',
  })

  assert.equal(result.paddle_transaction_id, 'txn_annual123')
  assert.match(calls[0].sql, /reservation_token = \$1::uuid/)
  assert.match(calls[0].sql, /user_id = \$2/)
  assert.match(calls[0].sql, /paddle_environment = \$3/)
  assert.deepEqual(calls[0].params, [reservation.reservation_token, 42, 'sandbox'])

  const invalid = await loadCheckoutReservationForSync({
    db,
    reservationToken: 'not-a-reservation',
    userId: 42,
    environment: 'sandbox',
  })
  assert.equal(invalid, null)
  assert.equal(calls.length, 1)
})

test('server reservation correlation overrides stale browser transaction state', () => {
  assert.equal(resolveCheckoutSyncTransactionId({
    transactionId: 'txn_stale123',
    reservation: { paddle_transaction_id: 'txn_exact123' },
  }), 'txn_exact123')
  assert.equal(resolveCheckoutSyncTransactionId({
    transactionId: 'txn_browser123',
    reservation: { paddle_transaction_id: null },
  }), 'txn_browser123')
})

test('a different plan safely cancels its verified unpaid Paddle checkout before releasing the reservation', async (t) => {
  const { acquisition, transaction, paddle: paddleConfig } = checkoutReservationFixture()
  const calls = []
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rowCount: 1, rows: [{ ...acquisition.reservation, status: 'failed' }] }
    },
  }
  const providerCalls = []
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    providerCalls.push({ url: String(url), options })
    const data = options.method === 'PATCH' ? { ...transaction, status: 'canceled' } : transaction
    return { ok: true, status: 200, json: async () => ({ data }) }
  })

  const result = await supersedeCheckoutReservation({ acquisition, paddle: paddleConfig, db })

  assert.equal(result.action, 'retry')
  assert.deepEqual(providerCalls.map(({ options }) => options.method || 'GET'), ['GET', 'PATCH'])
  assert.deepEqual(JSON.parse(providerCalls[1].options.body), { status: 'canceled' })
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /status = \$3/)
  assert.equal(calls[0].params[2], 'failed')
  assert.equal(calls[0].params[5], 'canceled')
  assert.equal(calls[0].params[6], 'superseded_by_new_purchase')
})

test('a closed checkout without a reusable URL is still canceled before changing plans', async (t) => {
  const { acquisition, transaction, paddle: paddleConfig } = checkoutReservationFixture()
  const closedTransaction = { ...transaction, checkout: { url: null } }
  const calls = []
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rowCount: 1, rows: [{ ...acquisition.reservation, status: 'failed' }] }
    },
  }
  const providerCalls = []
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    providerCalls.push(options.method || 'GET')
    const data = options.method === 'PATCH'
      ? { ...closedTransaction, status: 'canceled' }
      : closedTransaction
    return { ok: true, status: 200, json: async () => ({ data }) }
  })

  const result = await supersedeCheckoutReservation({ acquisition, paddle: paddleConfig, db })

  assert.equal(result.action, 'retry')
  assert.deepEqual(providerCalls, ['GET', 'PATCH'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params[6], 'superseded_by_new_purchase')
})

test('a timed-out Paddle cancellation is released only after a provider read confirms cancellation', async (t) => {
  const { acquisition, transaction, paddle: paddleConfig } = checkoutReservationFixture()
  const calls = []
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rowCount: 1, rows: [{ ...acquisition.reservation, status: 'failed' }] }
    },
  }
  let providerCall = 0
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    providerCall += 1
    if (providerCall === 2 && options.method === 'PATCH') {
      return { ok: false, status: 504, json: async () => ({}) }
    }
    const data = providerCall === 3 ? { ...transaction, status: 'canceled' } : transaction
    return { ok: true, status: 200, json: async () => ({ data }) }
  })

  const result = await supersedeCheckoutReservation({ acquisition, paddle: paddleConfig, db })

  assert.equal(result.action, 'retry')
  assert.equal(providerCall, 3)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params[6], 'superseded_by_new_purchase')
})

test('a different plan remains blocked when Paddle does not confirm the old checkout was canceled', async (t) => {
  const { acquisition, transaction, paddle: paddleConfig } = checkoutReservationFixture()
  const db = { async query() { throw new Error('reservation must stay open') } }
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      return { ok: false, status: 409, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => ({ data: transaction }) }
  })

  const result = await supersedeCheckoutReservation({ acquisition, paddle: paddleConfig, db })

  assert.equal(result.action, 'in_progress')
})

test('a canceled checkout is not retried when its reservation changed concurrently', async (t) => {
  const { acquisition, transaction, paddle: paddleConfig } = checkoutReservationFixture()
  const db = { async query() { return { rowCount: 0, rows: [] } } }
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({ data: options.method === 'PATCH' ? { ...transaction, status: 'canceled' } : transaction }),
  }))

  const result = await supersedeCheckoutReservation({ acquisition, paddle: paddleConfig, db })

  assert.equal(result.action, 'conflict')
})

test('a different plan never cancels a checkout that has already completed', async (t) => {
  const { acquisition, transaction, paddle: paddleConfig } = checkoutReservationFixture()
  const calls = []
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rowCount: 1, rows: [{ ...acquisition.reservation, status: 'completed' }] }
    },
  }
  const providerCalls = []
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    providerCalls.push(options.method || 'GET')
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { ...transaction, status: 'completed', subscription_id: 'sub_new' } }),
    }
  })

  const result = await supersedeCheckoutReservation({ acquisition, paddle: paddleConfig, db })

  assert.equal(result.action, 'completed')
  assert.deepEqual(providerCalls, ['GET'])
  assert.equal(calls[0].params[2], 'completed')
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

test('checkout preflight repairs a stale local Active state before deciding whether to block resubscription', async () => {
  const calls = []
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params })
      if (/UPDATE users/.test(String(sql))) return { rowCount: 1, rows: [{ id: 42 }] }
      return { rowCount: 1, rows: [] }
    },
    release() {},
  }
  const db = { async connect() { return client } }
  const paddleConfig = {
    environment: 'sandbox',
    priceIdsByPlan: { monthly: 'pri_monthly', annual: 'pri_annual' },
    noTrialPriceIdsByPlan: {},
    legacyPriceIdsByPlan: {},
  }
  const currentUser = {
    id: 42,
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_customer_id: 'ctm_123',
    paddle_subscription_id: 'sub_123',
    paddle_environment: 'sandbox',
    current_period_end: '2026-07-28T00:00:00.000Z',
    subscription_renewal_date: '2026-07-28T00:00:00.000Z',
    next_billing_date: '2026-07-28T00:00:00.000Z',
    cancellation_effective_at: '2026-07-28T00:00:00.000Z',
    last_paddle_event_at: '2026-07-27T00:00:00.000Z',
  }
  const providerSubscription = {
    id: 'sub_123',
    customer_id: 'ctm_123',
    status: 'canceled',
    updated_at: '2026-07-28T08:00:00.000Z',
    canceled_at: '2026-07-28T00:00:00.000Z',
    current_billing_period: null,
    next_billed_at: null,
    items: [],
  }

  const preflight = await prepareCheckoutSubscriptionState({
    user: currentUser,
    paddle: paddleConfig,
    providerSubscription,
    reconcile: (args) => reconcilePaddleSubscriptionState({ ...args, db }),
  })

  assert.equal(preflight.providerSubscriptionVerified, true)
  assert.equal(preflight.reconciliationReason, 'updated')
  assert.equal(preflight.user.subscription_status, 'cancelled')
  assert.equal(preflight.user.next_billing_date, null)
  assert.equal(
    getCheckoutBlockReason(preflight.user, providerSubscription, new Date('2026-07-29T00:00:00.000Z')),
    null,
  )
  assert.ok(calls.some(({ sql }) => /UPDATE users/.test(sql)))
})

test('checkout preflight accepts a matching terminal snapshot before a newer event watermark', async () => {
  const calls = []
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params })
      if (/UPDATE users/.test(String(sql))) return { rowCount: 1, rows: [{ id: 42 }] }
      return { rowCount: 1, rows: [] }
    },
    release() {},
  }
  const db = { async connect() { return client } }
  const paddleConfig = {
    environment: 'sandbox',
    priceIdsByPlan: { monthly: 'pri_monthly', annual: 'pri_annual' },
    noTrialPriceIdsByPlan: {},
    legacyPriceIdsByPlan: {},
  }
  const currentUser = {
    id: 42,
    subscription_status: 'cancelled',
    subscription_plan: 'annual',
    paddle_customer_id: 'ctm_123',
    paddle_subscription_id: 'sub_123',
    paddle_environment: 'sandbox',
    current_period_end: '2025-08-25T00:00:00.000Z',
    subscription_renewal_date: null,
    next_billing_date: null,
    cancellation_effective_at: '2025-08-25T00:00:00.000Z',
    last_paddle_event_at: '2025-08-25T00:05:00.000Z',
  }
  const providerSubscription = {
    id: 'sub_123',
    customer_id: 'ctm_123',
    status: 'canceled',
    updated_at: '2025-08-25T00:00:00.000Z',
    canceled_at: '2025-08-25T00:00:00.000Z',
    current_billing_period: null,
    next_billed_at: null,
    items: [],
  }

  const preflight = await prepareCheckoutSubscriptionState({
    user: currentUser,
    paddle: paddleConfig,
    providerSubscription,
    reconcile: (args) => reconcilePaddleSubscriptionState({ ...args, db }),
  })

  assert.equal(preflight.providerSubscriptionVerified, true)
  assert.equal(preflight.reconciliationReason, 'updated')
  assert.equal(preflight.user.subscription_status, 'cancelled')
  assert.equal(preflight.user.last_paddle_event_at, currentUser.last_paddle_event_at)
  assert.equal(getCheckoutBlockReason(preflight.user, providerSubscription, new Date('2026-08-26T00:00:00.000Z')), null)

  const update = calls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.ok(update)
  assert.equal(update.params[14], true)
  assert.match(update.sql, /last_paddle_event_at = GREATEST/)
})

test('checkout preflight does not relax the event watermark for non-terminal lifecycles', async () => {
  const calls = []
  const reconcile = async (args) => {
    calls.push(args)
    return { reconciled: false, providerVerified: false, reason: 'stale_provider_snapshot' }
  }

  const preflight = await prepareCheckoutSubscriptionState({
    user: {
      subscription_status: 'active',
      cancellation_effective_at: null,
    },
    paddle: { environment: 'sandbox' },
    providerSubscription: { status: 'active' },
    reconcile,
  })

  assert.equal(calls[0].allowCommandSnapshotBeforeEventWatermark, false)
  assert.equal(preflight.providerSubscriptionVerified, false)
  assert.equal(preflight.reconciliationReason, 'stale_provider_snapshot')
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

test('checkout transaction reuse requires exact account, environment, plan, price, mode, trial, and reservation identity', () => {
  const reservation = {
    reservation_token: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
    paddle_environment: 'sandbox',
    requested_plan: 'annual',
    stored_plan: 'annual',
    price_id: 'pri_annual_paid',
    checkout_mode: 'paid_returning',
    trial_eligible: false,
  }
  const user = { id: 42, paddle_customer_id: 'ctm_123' }
  const transaction = {
    id: 'txn_123',
    status: 'ready',
    customer_id: 'ctm_123',
    items: [{ price_id: 'pri_annual_paid', quantity: 1 }],
    custom_data: {
      userId: 42,
      paddleEnvironment: 'sandbox',
      requestedPlan: 'annual',
      plan: 'annual',
      checkoutMode: 'paid_returning',
      trialEligible: false,
      checkoutReservationId: reservation.reservation_token,
    },
  }

  assert.equal(transactionMatchesCheckoutReservation(transaction, reservation, user), true)
  assert.equal(transactionMatchesCheckoutReservation({ ...transaction, customer_id: 'ctm_other' }, reservation, user), false)
  assert.equal(transactionMatchesCheckoutReservation({ ...transaction, items: [{ price_id: 'pri_monthly_paid' }] }, reservation, user), false)
  assert.equal(transactionMatchesCheckoutReservation({
    ...transaction,
    custom_data: { ...transaction.custom_data, checkoutReservationId: '6b2ca06a-da77-44fc-af0e-c9de45ab14fd' },
  }, reservation, user), false)
  assert.equal(transactionMatchesCheckoutReservation({
    ...transaction,
    custom_data: { ...transaction.custom_data, paddleEnvironment: 'production' },
  }, reservation, user), false)
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
        starts_at: '2026-07-23T05:30:00.000+05:30',
        ends_at: '2026-08-23T05:30:00.000+05:30',
      },
      next_billed_at: '2026-08-23T05:30:00.000+05:30',
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
  assert.equal(update.params[5], '2026-08-23T00:00:00.000Z')
  assert.equal(update.params[6], '2026-08-23T00:00:00.000Z')
  assert.equal(update.params[7], '2026-07-23T00:00:00.000Z')
  assert.match(update.sql, /cancellation_effective_at = NULL/)
  assert.match(update.sql, /cancellation_reason = NULL/)
  assert.equal(calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)), true)
  assert.equal(calls.at(-1).sql, 'COMMIT')
})

test('persistVerifiedCheckoutSubscription authoritatively recovers the same Past Due Monthly lifecycle and resolves only matching retries', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql: String(sql), params })
    return { rowCount: 1, rows: [{ id: 42 }] }
  } }
  const result = await persistVerifiedCheckoutSubscription({
    client,
    user: {
      id: 42,
      subscription_status: 'past_due',
      subscription_plan: 'monthly',
      paddle_customer_id: 'ctm_123',
      paddle_subscription_id: 'sub_monthly',
      paddle_environment: 'sandbox',
    },
    transaction: { id: 'txn_overdue', status: 'completed', customer_id: 'ctm_123', subscription_id: 'sub_monthly' },
    subscription: {
      id: 'sub_monthly', status: 'active', customer_id: 'ctm_123',
      items: [{ price: { id: 'pri_monthly' } }],
      current_billing_period: { starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-08-01T00:00:00Z' },
      next_billed_at: '2026-08-01T00:00:00Z',
    },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_monthly' } },
  })

  assert.equal(result.result, 'recovered')
  assert.equal(result.plan, 'monthly')
  assert.equal(result.subscriptionId, 'sub_monthly')
  const userUpdate = calls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.match(userUpdate.sql, /WHEN \$10::boolean THEN GREATEST\(COALESCE\(last_paddle_event_at, NOW\(\)\), NOW\(\)\)/)
  const retryUpdate = calls.find(({ sql }) => /UPDATE payment_attempts/.test(sql))
  assert.ok(retryUpdate)
  assert.deepEqual(retryUpdate.params.slice(0, 3), [42, 'sandbox', 'sub_monthly'])
  assert.match(retryUpdate.sql, /status IN \('pending', 'failed', 'retrying'\)/)
  assert.equal(calls.at(-1).sql, 'COMMIT')
})

function pastDueRecoveryFixture(userOverrides = {}) {
  return {
    user: {
      id: 42,
      subscription_status: 'past_due',
      subscription_plan: 'monthly',
      paddle_customer_id: 'ctm_123',
      paddle_subscription_id: 'sub_monthly',
      paddle_environment: 'sandbox',
      last_paddle_event_at: '2026-07-01T10:00:00.000Z',
      ...userOverrides,
    },
    transaction: { id: 'txn_overdue', status: 'completed', customer_id: 'ctm_123', subscription_id: 'sub_monthly' },
    subscription: {
      id: 'sub_monthly', status: 'active', customer_id: 'ctm_123',
      items: [{ price: { id: 'pri_monthly' } }],
      current_billing_period: { starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-08-01T00:00:00Z' },
      next_billed_at: '2026-08-01T00:00:00Z',
    },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_monthly' } },
  }
}

test('persistVerifiedCheckoutSubscription classifies a concurrent cancellation as superseded without resolving retries', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql: String(sql), params })
    if (/UPDATE users/.test(sql)) return { rowCount: 0, rows: [] }
    if (/SELECT subscription_status/.test(sql)) return { rowCount: 1, rows: [{
      subscription_status: 'cancelled',
      subscription_plan: 'monthly',
      paddle_customer_id: 'ctm_123',
      paddle_subscription_id: 'sub_monthly',
      paddle_environment: 'sandbox',
      cancellation_effective_at: '2026-07-01T10:05:00.000Z',
      last_paddle_event_at: '2026-07-01T10:05:00.000Z',
    }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await persistVerifiedCheckoutSubscription({ client, ...pastDueRecoveryFixture() })

  assert.deepEqual(result, { synced: false, reason: 'recovery_superseded' })
  assert.ok(!calls.some(({ sql }) => /UPDATE payment_attempts/.test(sql)))
  assert.ok(!calls.some(({ sql }) => sql === 'COMMIT'))
})

test('persistVerifiedCheckoutSubscription preserves a concurrent newer failure event', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql: String(sql), params })
    if (/UPDATE users/.test(sql)) return { rowCount: 0, rows: [] }
    if (/SELECT subscription_status/.test(sql)) return { rowCount: 1, rows: [{
      ...pastDueRecoveryFixture().user,
      last_paddle_event_at: '2026-07-01T10:06:00.000Z',
    }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await persistVerifiedCheckoutSubscription({ client, ...pastDueRecoveryFixture() })

  assert.deepEqual(result, { synced: false, reason: 'recovery_superseded' })
  assert.ok(!calls.some(({ sql }) => /UPDATE payment_attempts/.test(sql)))
})

test('persistVerifiedCheckoutSubscription classifies an idempotent concurrent recovery as already recovered', async () => {
  const client = { async query(sql) {
    if (/UPDATE users/.test(sql)) return { rowCount: 0, rows: [] }
    if (/SELECT subscription_status/.test(sql)) return { rowCount: 1, rows: [{
      subscription_status: 'active', subscription_plan: 'monthly', paddle_subscription_id: 'sub_monthly',
      paddle_customer_id: 'ctm_123', paddle_environment: 'sandbox',
      current_period_end: '2026-08-01T00:00:00Z', next_billing_date: '2026-08-01T00:00:00Z',
    }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await persistVerifiedCheckoutSubscription({ client, ...pastDueRecoveryFixture() })

  assert.equal(result.result, 'already_recovered')
  assert.equal(result.synced, true)
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
