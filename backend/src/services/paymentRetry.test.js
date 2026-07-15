import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import { recordFailedPaymentAttempt, retryFailedPayments } from './paymentRetry.js'

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
  assert.equal(calls[0].params[8], 'production')
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
    return { rows: [{ transaction_id: params[0], paddle_environment: params[8] }] }
  })

  const attempt = await recordFailedPaymentAttempt({
    event_type: 'transaction.payment_failed',
    data: { id: 'txn_sandbox_failed' },
  }, null, 'sandbox')

  assert.equal(attempt.paddle_environment, 'sandbox')
  assert.equal(calls[0].params[8], 'sandbox')
  assert.match(calls[0].sql, /paddle_environment/)
})

test('retryFailedPayments charges sandbox attempts through sandbox Paddle credentials', async (t) => {
  const originalFetch = globalThis.fetch
  const originalSandboxBaseUrl = process.env.PADDLE_SANDBOX_API_BASE_URL
  const originalSandboxApiKey = process.env.PADDLE_SANDBOX_API_KEY
  t.after(() => {
    globalThis.fetch = originalFetch
    if (originalSandboxBaseUrl === undefined) delete process.env.PADDLE_SANDBOX_API_BASE_URL
    else process.env.PADDLE_SANDBOX_API_BASE_URL = originalSandboxBaseUrl
    if (originalSandboxApiKey === undefined) delete process.env.PADDLE_SANDBOX_API_KEY
    else process.env.PADDLE_SANDBOX_API_KEY = originalSandboxApiKey
  })

  process.env.PADDLE_SANDBOX_API_BASE_URL = 'https://sandbox-api.paddle.test'
  process.env.PADDLE_SANDBOX_API_KEY = 'sandbox-retry-key'
  const queries = []
  t.mock.method(pool, 'query', async (sql) => {
    queries.push(String(sql))
    if (String(sql).includes("WHERE status IN ('failed', 'retrying')")) {
      return {
        rowCount: 1,
        rows: [{
          id: 99,
          transaction_id: 'txn_sandbox_retry',
          retry_count: 0,
          paddle_environment: 'sandbox',
        }],
      }
    }
    if (String(sql).includes('SELECT 1 FROM payment_attempts')) return { rowCount: 0, rows: [] }
    return { rowCount: 1, rows: [] }
  })

  const fetchCalls = []
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options })
    return { ok: true }
  }

  const retried = await retryFailedPayments()

  assert.equal(retried, 1)
  assert.equal(fetchCalls[0].url, 'https://sandbox-api.paddle.test/transactions/txn_sandbox_retry/charge')
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer sandbox-retry-key')
  assert.ok(queries.some((sql) => sql.includes("SET status = 'succeeded'")))
})
