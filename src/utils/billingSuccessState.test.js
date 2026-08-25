import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PADDLE_LAST_TRANSACTION_STORAGE_KEY,
  resolveBillingSuccessState,
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

test('in-app checkout completion keeps its trusted navigation state', () => {
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
  assert.equal(result.checkoutReservationId, '42d85541-3b0e-4b1a-8dca-2525950fbaf0')
  assert.equal(result.plan, 'monthly')
  assert.equal(result.message, 'Welcome')
})

test('invalid browser correlation values are ignored', () => {
  const result = resolveBillingSuccessState({
    historyState: { transactionId: 'not-a-transaction', plan: 'enterprise' },
    search: '?checkout=not-a-reservation&plan=enterprise',
    storage: storageWith({ [PADDLE_LAST_TRANSACTION_STORAGE_KEY]: 'invalid' }),
  })

  assert.deepEqual(result, {
    transactionId: '',
    checkoutReservationId: '',
    plan: 'monthly',
    message: '',
  })
})
