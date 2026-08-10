import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { readFile } from 'node:fs/promises'

import subscriptionsRouter, {
  containsRawPaymentMethodField,
  PAYMENT_METHOD_UPDATE_ERROR,
} from './subscriptions.js'
import { pool } from '../db/client.js'

after(async () => {
  await pool.end().catch(() => {})
})

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.payload = body
      return this
    },
  }
}

async function invokePaymentMethodRoute(body) {
  const layer = subscriptionsRouter.stack.find((entry) => entry.route?.path === '/payment-method')
  assert.ok(layer, 'payment method route exists')

  const req = {
    path: '/api/subscriptions/payment-method',
    headers: { authorization: 'Bearer valid-token' },
    cookies: {},
    body,
  }
  const res = createRes()

  const originalVerify = jwt.verify
  jwt.verify = () => ({ userId: 123 })

  try {
    await new Promise((resolve, reject) => {
      layer.route.stack[0].handle(req, res, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await layer.route.stack[1].handle(req, res, () => {})
  } finally {
    jwt.verify = originalVerify
  }

  return res
}

test('payment method update detects raw card field names', () => {
  for (const field of ['cardNumber', 'card_number', 'pan', 'cvc', 'cvv', 'securityCode', 'security_code', 'expiryMonth', 'expiryYear', 'expMonth', 'expYear']) {
    assert.equal(containsRawPaymentMethodField({ [field]: 'sensitive-value' }), true, `${field} is rejected`)
  }

  assert.equal(containsRawPaymentMethodField({ paymentToken: 'tok_123' }), false)
})

test('POST /api/subscriptions/payment-method safely rejects raw card payloads without DB writes or logs', async () => {
  const originalQuery = pool.query
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  const queryCalls = []
  const logCalls = []

  pool.query = async (...args) => {
    queryCalls.push(args)
    throw new Error('pool.query should not be called')
  }
  console.info = (...args) => logCalls.push(args)
  console.warn = (...args) => logCalls.push(args)
  console.error = (...args) => logCalls.push(args)

  try {
    const res = await invokePaymentMethodRoute({
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear: '2030',
      cvc: '123',
    })

    assert.equal(res.statusCode, 400)
    assert.deepEqual(res.payload, { error: PAYMENT_METHOD_UPDATE_ERROR })
    assert.equal(queryCalls.length, 0)
    assert.equal(logCalls.length, 0)
  } finally {
    pool.query = originalQuery
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
  }
})

test('POST /api/subscriptions/payment-method allows active updates and past-due recovery through Paddle', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.PADDLE_API_KEY
  const originalClientToken = process.env.PADDLE_CLIENT_TOKEN
  const originalEnvironment = process.env.PADDLE_ENVIRONMENT

  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_API_KEY = 'paddle-api-key'
  process.env.PADDLE_CLIENT_TOKEN = 'paddle-client-token'

  try {
    for (const scenario of [
      { status: 'active', action: 'update_payment_method' },
      { status: 'past_due', action: 'pay_overdue' },
    ]) {
      pool.query = async (sql) => {
        if (String(sql).includes('FROM users')) {
          return { rows: [{ id: 123, subscription_status: scenario.status, paddle_customer_id: 'ctm_123', paddle_subscription_id: 'sub_123', paddle_environment: 'production' }] }
        }
        return { rows: [], rowCount: 1 }
      }
      let paddleCallCount = 0
      globalThis.fetch = async (url, options) => {
        paddleCallCount += 1
        assert.equal(options.headers.Authorization, 'Bearer paddle-api-key')
        if (paddleCallCount === 1) {
          assert.match(String(url), /\/subscriptions\/sub_123$/)
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ data: {
              id: 'sub_123',
              customer_id: 'ctm_123',
              status: scenario.status,
              collection_mode: 'automatic',
            } }),
          }
        }

        assert.match(String(url), /\/subscriptions\/sub_123\/update-payment-method-transaction$/)
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ data: {
            id: 'txn_update_123',
            customer_id: 'ctm_123',
            subscription_id: 'sub_123',
            checkout: { url: 'https://checkout.paddle.test/update' },
          } }),
        }
      }

      const res = await invokePaymentMethodRoute({})
      assert.equal(res.statusCode, 200, scenario.status)
      assert.equal(res.payload.action, scenario.action)
      assert.equal(res.payload.transactionId, 'txn_update_123')
      assert.equal(res.payload.paddleEnvironment, 'production')
      assert.equal(paddleCallCount, 2, scenario.status)
    }
  } finally {
    pool.query = originalQuery
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.PADDLE_API_KEY
    else process.env.PADDLE_API_KEY = originalApiKey
    if (originalClientToken === undefined) delete process.env.PADDLE_CLIENT_TOKEN
    else process.env.PADDLE_CLIENT_TOKEN = originalClientToken
    if (originalEnvironment === undefined) delete process.env.PADDLE_ENVIRONMENT
    else process.env.PADDLE_ENVIRONMENT = originalEnvironment
  }
})

test('POST /api/subscriptions/payment-method rejects locally ineligible states before Paddle', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch

  try {
    for (const subscriptionStatus of ['trialing', 'paused', 'cancelled', 'inactive', 'mystery']) {
      let paddleCalls = 0
      pool.query = async (sql) => {
        if (String(sql).includes('FROM users')) {
          return { rows: [{
            id: 123,
            subscription_status: subscriptionStatus,
            paddle_customer_id: 'ctm_123',
            paddle_subscription_id: 'sub_123',
            paddle_environment: 'production',
          }] }
        }
        return { rows: [], rowCount: 1 }
      }
      globalThis.fetch = async () => {
        paddleCalls += 1
        throw new Error('Paddle must not be called')
      }

      const res = await invokePaymentMethodRoute({})

      assert.equal(res.statusCode, 409, subscriptionStatus)
      assert.equal(res.payload.code, 'PAYMENT_METHOD_NOT_ALLOWED', subscriptionStatus)
      assert.equal(paddleCalls, 0, subscriptionStatus)
    }
  } finally {
    pool.query = originalQuery
    globalThis.fetch = originalFetch
  }
})

test('POST /api/subscriptions/payment-method rejects missing provider identifiers before Paddle', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch

  try {
    for (const providerIds of [
      { paddle_customer_id: null, paddle_subscription_id: 'sub_123' },
      { paddle_customer_id: 'ctm_123', paddle_subscription_id: null },
    ]) {
      let paddleCalls = 0
      pool.query = async (sql) => {
        if (String(sql).includes('FROM users')) {
          return { rows: [{
            id: 123,
            subscription_status: 'active',
            paddle_environment: 'production',
            ...providerIds,
          }] }
        }
        return { rows: [], rowCount: 1 }
      }
      globalThis.fetch = async () => {
        paddleCalls += 1
        throw new Error('Paddle must not be called')
      }

      const res = await invokePaymentMethodRoute({})

      assert.equal(res.statusCode, 409)
      assert.match(res.payload.error, /billing provider subscription is missing/i)
      assert.equal(paddleCalls, 0)
    }
  } finally {
    pool.query = originalQuery
    globalThis.fetch = originalFetch
  }
})

test('POST /api/subscriptions/payment-method rejects unowned or provider-ineligible subscriptions before creating a transaction', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.PADDLE_API_KEY
  const originalEnvironment = process.env.PADDLE_ENVIRONMENT

  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_API_KEY = 'paddle-api-key'

  const scenarios = [
    { name: 'foreign subscription', provider: { id: 'sub_other' } },
    { name: 'foreign customer', provider: { customer_id: 'ctm_other' } },
    { name: 'trialing', provider: { status: 'trialing' } },
    { name: 'paused', provider: { status: 'paused' } },
    { name: 'cancelled', provider: { status: 'canceled' } },
    { name: 'unknown', provider: { status: 'mystery' } },
    { name: 'scheduled cancellation', provider: { scheduled_change: { action: 'cancel' } } },
    { name: 'manual collection', provider: { collection_mode: 'manual' } },
  ]

  try {
    for (const scenario of scenarios) {
      pool.query = async (sql) => {
        if (String(sql).includes('FROM users')) {
          return { rows: [{
            id: 123,
            subscription_status: 'active',
            paddle_customer_id: 'ctm_123',
            paddle_subscription_id: 'sub_123',
            paddle_environment: 'production',
          }] }
        }
        return { rows: [], rowCount: 1 }
      }
      const paddleCalls = []
      globalThis.fetch = async (url) => {
        paddleCalls.push(String(url))
        assert.equal(paddleCalls.length, 1, `${scenario.name} must stop before transaction creation`)
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ data: {
            id: 'sub_123',
            customer_id: 'ctm_123',
            status: 'active',
            collection_mode: 'automatic',
            scheduled_change: null,
            ...scenario.provider,
          } }),
        }
      }

      const res = await invokePaymentMethodRoute({})

      assert.equal(res.statusCode, 409, scenario.name)
      assert.equal(res.payload.code, 'PAYMENT_METHOD_NOT_ALLOWED', scenario.name)
      assert.equal(paddleCalls.length, 1, scenario.name)
      assert.match(paddleCalls[0], /\/subscriptions\/sub_123$/)
    }
  } finally {
    pool.query = originalQuery
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.PADDLE_API_KEY
    else process.env.PADDLE_API_KEY = originalApiKey
    if (originalEnvironment === undefined) delete process.env.PADDLE_ENVIRONMENT
    else process.env.PADDLE_ENVIRONMENT = originalEnvironment
  }
})

test('POST /api/subscriptions/payment-method uses the linked environment and rejects a missing subscription without cross-environment fallback', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch
  const originalEnvironment = process.env.PADDLE_ENVIRONMENT
  const originalSandboxApiKey = process.env.PADDLE_SANDBOX_API_KEY

  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_SANDBOX_API_KEY = 'sandbox-api-key'
  pool.query = async (sql) => {
    if (String(sql).includes('FROM users')) {
      return { rows: [{
        id: 123,
        subscription_status: 'active',
        paddle_customer_id: 'ctm_123',
        paddle_subscription_id: 'sub_sandbox_missing',
        paddle_environment: 'sandbox',
      }] }
    }
    return { rows: [], rowCount: 1 }
  }
  const paddleCalls = []
  globalThis.fetch = async (url, options) => {
    paddleCalls.push(String(url))
    assert.equal(options.headers.Authorization, 'Bearer sandbox-api-key')
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ error: { code: 'not_found' } }),
    }
  }

  try {
    const res = await invokePaymentMethodRoute({})

    assert.equal(res.statusCode, 502)
    assert.equal(paddleCalls.length, 1)
    assert.match(paddleCalls[0], /^https:\/\/sandbox-api\.paddle\.com\/subscriptions\/sub_sandbox_missing$/)
  } finally {
    pool.query = originalQuery
    globalThis.fetch = originalFetch
    if (originalEnvironment === undefined) delete process.env.PADDLE_ENVIRONMENT
    else process.env.PADDLE_ENVIRONMENT = originalEnvironment
    if (originalSandboxApiKey === undefined) delete process.env.PADDLE_SANDBOX_API_KEY
    else process.env.PADDLE_SANDBOX_API_KEY = originalSandboxApiKey
  }
})

test('POST /api/subscriptions/payment-method rejects a transaction owned by another billing identity', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.PADDLE_API_KEY

  process.env.PADDLE_API_KEY = 'paddle-api-key'
  pool.query = async (sql) => {
    if (String(sql).includes('FROM users')) {
      return { rows: [{
        id: 123,
        subscription_status: 'active',
        paddle_customer_id: 'ctm_123',
        paddle_subscription_id: 'sub_123',
        paddle_environment: 'production',
      }] }
    }
    return { rows: [], rowCount: 1 }
  }
  let paddleCalls = 0
  globalThis.fetch = async () => {
    paddleCalls += 1
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: paddleCalls === 1
        ? {
            id: 'sub_123',
            customer_id: 'ctm_123',
            status: 'active',
            collection_mode: 'automatic',
          }
        : {
            id: 'txn_update_123',
            customer_id: 'ctm_other',
            subscription_id: 'sub_123',
            checkout: { url: 'https://checkout.paddle.test/update' },
          } }),
    }
  }

  try {
    const res = await invokePaymentMethodRoute({})

    assert.equal(res.statusCode, 409)
    assert.equal(res.payload.code, 'PAYMENT_METHOD_NOT_ALLOWED')
    assert.equal(paddleCalls, 2)
  } finally {
    pool.query = originalQuery
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.PADDLE_API_KEY
    else process.env.PADDLE_API_KEY = originalApiKey
  }
})

test('UpdatePaymentMethodPage does not render or submit raw card fields', async () => {
  const source = await readFile(new URL('../../../src/pages/UpdatePaymentMethodPage.jsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /Card Number|CVC|cardNumber|expiryMonth|expiryYear|securityCode/)
  assert.match(source, /\/subscriptions\/payment-method/)
  assert.match(source, /Paddle\.Checkout\.open/)
  assert.match(source, /eventCallback/)
  assert.match(source, /checkout\.completed/)
  assert.match(source, /syncCompletedCheckout/)
  assert.match(source, /transactionId/)
  assert.match(source, /\/auth\/me/)
  assert.match(source, /\/billing\?payment_method=updated/)
  assert.doesNotMatch(source, /body:\s*JSON\.stringify\(/)
  assert.match(source, /Paddle&apos;s secure billing flow/)
  assert.match(source, /Continue with Paddle/)
})
