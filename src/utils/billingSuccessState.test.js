import test from 'node:test'
import assert from 'node:assert/strict'
import {
  completedCheckoutNavigation,
  PADDLE_LAST_TRANSACTION_STORAGE_KEY,
  resolveBillingSuccessState,
  verifiedCheckoutNavigation,
} from './billingSuccessState.js'

function storageWith(values = {}) {
  return {
    getItem(key) {
      return values[key] || null
    },
  }
}

test('direct Paddle return recovers the stored transaction and exact checkout reservation', () => {
  const result = resolveBillingSuccessState({
    historyState: null,
    search: '?checkout=42d85541-3b0e-4b1a-8dca-2525950fbaf0&plan=annual',
    storage: storageWith({ [PADDLE_LAST_TRANSACTION_STORAGE_KEY]: 'txn_completed123' }),
  })

  assert.deepEqual(result, {
    transactionId: 'txn_completed123',
    checkoutReservationId: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
    plan: 'annual',
    message: '',
  })
})

test('billing success prefers durable URL correlation over stale navigation state', () => {
  const result = resolveBillingSuccessState({
    historyState: {
      transactionId: 'txn_history123',
      checkoutReservationId: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
      plan: 'monthly',
      message: 'Welcome',
    },
    search: '?checkout=6b2ca06a-da77-44fc-af0e-c9de45ab14fd&plan=annual',
    storage: storageWith({ [PADDLE_LAST_TRANSACTION_STORAGE_KEY]: 'txn_stored123' }),
  })

  assert.equal(result.transactionId, 'txn_history123')
  assert.equal(result.checkoutReservationId, '6b2ca06a-da77-44fc-af0e-c9de45ab14fd')
  assert.equal(result.plan, 'annual')
  assert.equal(result.message, 'Welcome')
})

test('verified success URL stays on billing success and survives reload without browser state', () => {
  const origin = 'https://hireflow.dev'
  const payload = {
    checkoutUrl: 'https://hireflow.dev/checkout?_ptxn=txn_growth123',
    transactionId: 'txn_growth123',
    checkoutReservationId: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
    plan: 'growth_monthly',
    successUrl: `${origin}/billing/success?transaction=txn_growth123&checkout=42d85541-3b0e-4b1a-8dca-2525950fbaf0&plan=growth_monthly`,
  }
  const verified = verifiedCheckoutNavigation(payload, origin)
  assert.equal(verified.url, payload.successUrl)
  assert.equal(new URL(verified.url).pathname, '/billing/success')
  assert.deepEqual(resolveBillingSuccessState({ search: new URL(verified.url).search }), {
    ...verified.state, message: '',
  })

  for (const successUrl of [
    `${origin}/checkout?transaction=txn_growth123&checkout=${payload.checkoutReservationId}&plan=growth_monthly`,
    payload.successUrl.replace(origin, 'https://attacker.test'),
    payload.successUrl.replace('txn_growth123', 'bad'),
    payload.successUrl.replace(payload.checkoutReservationId, 'invalid'),
    payload.successUrl.replace('growth_monthly', 'pro_monthly'),
    `${payload.successUrl}&transaction=txn_other123`,
  ]) {
    assert.equal(verifiedCheckoutNavigation({ ...payload, successUrl }, origin), null)
  }
  assert.equal(verifiedCheckoutNavigation({ ...payload, plan: 'unsupported' }, origin), null)
})

test('signed-in customer can retry an existing checkout after closing its original tab', () => {
  const result = resolveBillingSuccessState({
    search: '?transaction=txn_completed123&plan=starter_annual',
    storage: storageWith(),
  })

  assert.equal(result.transactionId, 'txn_completed123')
  assert.equal(result.plan, 'starter_annual')
})

test('invalid browser correlation values are ignored', () => {
  const result = resolveBillingSuccessState({
    historyState: { transactionId: 'not-a-transaction', plan: 'enterprise' },
    search: '?checkout=not-a-reservation&transaction=not-a-transaction&plan=enterprise',
    storage: storageWith({ [PADDLE_LAST_TRANSACTION_STORAGE_KEY]: 'invalid' }),
  })

  assert.deepEqual(result, {
    transactionId: '',
    checkoutReservationId: '',
    plan: '',
    message: '',
  })
})

test('Paddle return preserves Starter and Growth plan codes for the confirmation page', () => {
  for (const plan of ['starter_monthly', 'starter_annual', 'growth_monthly', 'growth_annual']) {
    assert.equal(resolveBillingSuccessState({ search: `?plan=${plan}` }).plan, plan)
  }
})

test('completed checkout navigates with validated durable references, including after refresh', () => {
  const recovery = completedCheckoutNavigation({
    code: 'checkout_completed', transactionId: 'txn_exact123',
    checkoutReservationId: '42d85541-3b0e-4b1a-8dca-2525950fbaf0', plan: 'starter_monthly',
  })
  assert.deepEqual(recovery.state, {
    transactionId: 'txn_exact123',
    checkoutReservationId: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
    plan: 'starter_monthly',
  })
  assert.deepEqual(resolveBillingSuccessState({
    search: new URL(recovery.path, 'https://hireflow.test').search,
    storage: storageWith(),
  }), { ...recovery.state, message: '' })
  assert.equal(completedCheckoutNavigation({
    code: 'checkout_completed', transactionId: 'txn_exact123', checkoutReservationId: 'invalid', plan: 'starter_monthly',
  }), null)
})
