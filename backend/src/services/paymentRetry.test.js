import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import { recordFailedPaymentAttempt } from './paymentRetry.js'

test('recordFailedPaymentAttempt stores failed transaction details against aligned schema', async (t) => {
  const calls = []
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    return { rows: [{ transaction_id: params[0], status: 'failed', customer_email: params[2] }] }
  })

  const attempt = await recordFailedPaymentAttempt({
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_test',
      amount: '9900',
      currency_code: 'USD',
      customer: { email: 'customer@example.com' },
      custom_data: { userId: 40 },
      status_details: { reason: 'card_declined' },
    },
  })

  assert.equal(attempt.transaction_id, 'txn_failed_test')
  assert.equal(attempt.status, 'failed')
  assert.match(calls[0].sql, /INSERT INTO payment_attempts/)
  assert.match(calls[0].sql, /customer_email/)
  assert.match(calls[0].sql, /ON CONFLICT \(transaction_id\)/)
  assert.equal(calls[0].params[0], 'txn_failed_test')
  assert.equal(calls[0].params[1], 40)
  assert.equal(calls[0].params[2], 'customer@example.com')
  assert.equal(calls[0].params[4], 'USD')
})
