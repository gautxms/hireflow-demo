import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../../db/client.js'
import adminPaymentsRouter from './payments.js'
import adminSubscriptionsRouter from './subscriptions.js'

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }
}

async function invokeRoute(router, path, req) {
  const layer = router.stack.find((entry) => entry.route?.path === path)
  assert.ok(layer, `${path} route exists`)
  const res = createRes()
  await layer.route.stack[0].handle(req, res, () => {})
  return res
}

function configureSandbox(t) {
  const originalFetch = globalThis.fetch
  const originalBaseUrl = process.env.PADDLE_SANDBOX_API_BASE_URL
  const originalApiKey = process.env.PADDLE_SANDBOX_API_KEY
  t.after(() => {
    globalThis.fetch = originalFetch
    if (originalBaseUrl === undefined) delete process.env.PADDLE_SANDBOX_API_BASE_URL
    else process.env.PADDLE_SANDBOX_API_BASE_URL = originalBaseUrl
    if (originalApiKey === undefined) delete process.env.PADDLE_SANDBOX_API_KEY
    else process.env.PADDLE_SANDBOX_API_KEY = originalApiKey
  })

  process.env.PADDLE_SANDBOX_API_BASE_URL = 'https://sandbox-api.paddle.test'
  process.env.PADDLE_SANDBOX_API_KEY = 'sandbox-admin-key'
  const fetchCalls = []
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'sandbox-result' } }),
    }
  }
  return fetchCalls
}

test('admin payment retry uses the payment attempt Paddle environment', async (t) => {
  const fetchCalls = configureSandbox(t)
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('SELECT paddle_environment')) {
      return { rows: [{ paddle_environment: 'sandbox' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  })

  const res = await invokeRoute(adminPaymentsRouter, '/:transactionId/retry', {
    params: { transactionId: 'txn_sandbox_admin' },
  })

  assert.equal(res.statusCode, 200)
  assert.equal(fetchCalls[0].url, 'https://sandbox-api.paddle.test/transactions/txn_sandbox_admin/charge')
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer sandbox-admin-key')
})

test('admin subscription retry uses the owning user Paddle environment', async (t) => {
  const fetchCalls = configureSandbox(t)
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('SELECT bi.paddle_transaction_id')) {
      return {
        rows: [{
          paddle_transaction_id: 'txn_sandbox_subscription',
          paddle_environment: 'sandbox',
        }],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 1 }
  })

  const res = await invokeRoute(adminSubscriptionsRouter, '/:subscriptionId/retry-payment', {
    params: { subscriptionId: 'sub_sandbox_admin' },
  })

  assert.equal(res.statusCode, 200)
  assert.equal(fetchCalls[0].url, 'https://sandbox-api.paddle.test/transactions/txn_sandbox_subscription/charge')
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer sandbox-admin-key')
})
