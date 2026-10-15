import test from 'node:test'
import assert from 'node:assert/strict'
import {
  transactionMatchesCheckoutReservation,
  verifyNewPaidLifecycleCheckoutEvidence,
} from './paddlePaidLifecycleVerification.js'

const reservation = {
  reservation_token: '42d85541-3b0e-4b1a-8dca-2525950fbaf0',
  user_id: 42,
  paddle_environment: 'sandbox',
  requested_plan: 'growth_annual',
  stored_plan: 'growth_annual',
  price_id: 'pri_growth_annual_paid',
  trial_eligible: false,
  checkout_mode: 'paid_returning',
  status: 'ready',
  paddle_transaction_id: 'txn_growth',
  paddle_customer_id: 'ctm_growth',
}

const payload = {
  data: {
    customer_id: 'ctm_growth',
    items: [{ price: { id: 'pri_growth_annual_paid' }, quantity: 1 }],
    custom_data: {
      userId: 42,
      checkoutReservationId: reservation.reservation_token,
      requestedPlan: 'growth_annual',
      plan: 'growth_annual',
      paddleEnvironment: 'sandbox',
      checkoutMode: 'paid_returning',
      trialEligible: false,
    },
  },
}

test('new paid lifecycle evidence verifies exact user, environment, reservation, plan, price, mode, and transaction', async () => {
  const calls = []
  const result = await verifyNewPaidLifecycleCheckoutEvidence({
    db: { async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rowCount: 1, rows: [reservation] }
    } },
    user: { id: 42, paddle_customer_id: 'ctm_growth' },
    payload,
    environment: 'sandbox',
    plan: 'growth_annual',
    priceId: 'pri_growth_annual_paid',
    customerId: 'ctm_growth',
    transactionId: 'txn_growth',
  })

  assert.equal(result.verified, true)
  assert.equal(calls[0].params[0], reservation.reservation_token)
  assert.equal(calls[0].params[3], 'growth_annual')
  assert.equal(calls[0].params[4], 'pri_growth_annual_paid')
  assert.equal(calls[0].params[7], 'txn_growth')
})

test('new paid lifecycle evidence fails closed when reservation evidence or payload identity differs', async () => {
  const missing = await verifyNewPaidLifecycleCheckoutEvidence({
    db: { async query() { return { rowCount: 0, rows: [] } } },
    user: { id: 42, paddle_customer_id: 'ctm_growth' },
    payload,
    environment: 'sandbox',
    plan: 'growth_annual',
    priceId: 'pri_growth_annual_paid',
    customerId: 'ctm_growth',
    transactionId: 'txn_growth',
  })
  assert.deepEqual(missing, { verified: false, reason: 'new_paid_lifecycle_reservation_mismatch' })

  assert.equal(transactionMatchesCheckoutReservation({
    ...payload.data,
    custom_data: { ...payload.data.custom_data, plan: 'pro_annual' },
  }, reservation, { id: 42, paddle_customer_id: 'ctm_growth' }), false)
})
