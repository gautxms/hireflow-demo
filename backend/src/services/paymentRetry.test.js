import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  assert.match(calls[0].sql, /ON CONFLICT \(transaction_id\) WHERE transaction_id IS NOT NULL/)
  assert.equal(calls[0].params[0], 'txn_failed_test')
  assert.equal(calls[0].params[1], 40)
  assert.equal(calls[0].params[2], 'customer@example.com')
  assert.equal(calls[0].params[4], 'USD')
  assert.equal(calls[0].params[7], 'production')
  assert.match(calls[0].sql, /'failed', 0, NULL/)
  assert.match(calls[0].sql, /next_retry_at = NULL/)
})

test('recordFailedPaymentAttempt falls back to custom_data email when Paddle omits customer email', async (t) => {
  const calls = []
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    return { rows: [{ transaction_id: params[0], status: 'failed', customer_email: params[2] }] }
  })

  const attempt = await recordFailedPaymentAttempt({
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_custom_data_email',
      amount: '9900',
      currency_code: 'USD',
      custom_data: { userId: 40, email: 'fallback@example.com' },
      status_details: { reason: 'card_declined' },
    },
  })

  assert.equal(attempt.customer_email, 'fallback@example.com')
  assert.equal(calls[0].params[2], 'fallback@example.com')
})

test('recordFailedPaymentAttempt stores the webhook-selected sandbox environment', async (t) => {
  const calls = []
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    return { rows: [{ transaction_id: params[0], paddle_environment: params[7] }] }
  })

  const attempt = await recordFailedPaymentAttempt({
    event_type: 'transaction.payment_failed',
    data: { id: 'txn_sandbox_failed' },
  }, null, 'sandbox')

  assert.equal(attempt.paddle_environment, 'sandbox')
  assert.equal(calls[0].params[7], 'sandbox')
  assert.match(calls[0].sql, /paddle_environment/)
})

test('missing transaction diagnostics use identifiers without storing the full Paddle payload', async (t) => {
  const calls = []
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    return { rowCount: 1, rows: [] }
  })

  const result = await recordFailedPaymentAttempt({
    event_type: 'transaction.payment_failed',
    data: {
      customer_id: 'ctm_safe_diagnostic',
      subscription_id: 'sub_safe_diagnostic',
      custom_data: {
        userId: 40,
        paddleEnvironment: 'sandbox',
        email: 'must-not-be-logged@example.com',
      },
      card: { last4: '4242' },
    },
  })

  assert.equal(result, null)
  const errorInsert = calls.find(({ sql }) => /INSERT INTO error_logs/.test(sql))
  assert.ok(errorInsert)
  const context = JSON.parse(errorInsert.params[3])
  assert.deepEqual(context, {
    eventType: 'transaction.payment_failed',
    userId: 40,
    environment: 'sandbox',
    customerId: 'ctm_safe_diagnostic',
    subscriptionId: 'sub_safe_diagnostic',
    result: 'rejected_missing_transaction_id',
  })
  assert.doesNotMatch(errorInsert.params[3], /must-not-be-logged|4242|payload/i)
})

test('production startup and payment bookkeeping contain no local charge worker', () => {
  const paymentRetrySource = readFileSync(new URL('./paymentRetry.js', import.meta.url), 'utf8')
  const startupSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

  assert.doesNotMatch(paymentRetrySource, /transactions\/.*\/charge/)
  assert.doesNotMatch(paymentRetrySource, /retryFailedPayments/)
  assert.doesNotMatch(paymentRetrySource, /automatic_retry/)
  assert.doesNotMatch(startupSource, /retryFailedPayments|startPaymentRetryCron/)
  assert.match(startupSource, /startRecoveryBillingAdjustmentCron/)
})
