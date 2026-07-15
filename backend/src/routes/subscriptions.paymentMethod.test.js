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

test('POST /api/subscriptions/payment-method returns a Paddle-hosted update transaction', async () => {
  const originalQuery = pool.query
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.PADDLE_API_KEY
  const originalClientToken = process.env.PADDLE_CLIENT_TOKEN
  const originalEnvironment = process.env.PADDLE_ENVIRONMENT

  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_API_KEY = 'paddle-api-key'
  process.env.PADDLE_CLIENT_TOKEN = 'paddle-client-token'
  pool.query = async (sql) => {
    if (String(sql).includes('FROM users')) {
      return { rows: [{ id: 123, subscription_status: 'past_due', paddle_subscription_id: 'sub_123', paddle_environment: 'production' }] }
    }
    return { rows: [], rowCount: 1 }
  }
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/subscriptions\/sub_123\/update-payment-method-transaction$/)
    assert.equal(options.headers.Authorization, 'Bearer paddle-api-key')
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: { id: 'txn_update_123', checkout: { url: 'https://checkout.paddle.test/update' } } }),
    }
  }

  try {
    const res = await invokePaymentMethodRoute({})
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.payload, {
      status: 'ok',
      transactionId: 'txn_update_123',
      checkoutUrl: 'https://checkout.paddle.test/update',
      clientToken: 'paddle-client-token',
      paddleEnvironment: 'production',
      action: 'pay_overdue',
    })
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

test('UpdatePaymentMethodPage does not render or submit raw card fields', async () => {
  const source = await readFile(new URL('../../../src/pages/UpdatePaymentMethodPage.jsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /Card Number|CVC|cardNumber|expiryMonth|expiryYear|securityCode/)
  assert.match(source, /\/subscriptions\/payment-method/)
  assert.match(source, /Paddle\.Checkout\.open/)
  assert.doesNotMatch(source, /JSON\.stringify\(/)
  assert.match(source, /Paddle&apos;s secure billing flow/)
  assert.match(source, /Continue with Paddle/)
})
