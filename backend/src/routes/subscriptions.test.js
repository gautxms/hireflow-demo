import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

import subscriptionsRouter from './subscriptions.js'
import { pool } from '../db/client.js'

const BILLING_PROVIDER_MISSING_ERROR = 'Subscription cannot be changed because billing provider subscription is missing. Please contact support.'
const PADDLE_PRICE_MISSING_ERROR = 'Subscription cannot be changed because billing configuration is missing. Please contact support.'

const originalQuery = pool.query
const originalFetch = globalThis.fetch
const originalVerify = jwt.verify
const originalEnv = { ...process.env }
const originalConsoleInfo = console.info

after(async () => {
  pool.query = originalQuery
  globalThis.fetch = originalFetch
  jwt.verify = originalVerify
  process.env = originalEnv
  console.info = originalConsoleInfo
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

function resetPaddleEnv() {
  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_API_KEY = 'paddle-key'
  process.env.PADDLE_CLIENT_TOKEN = 'client-token'
  process.env.PADDLE_MONTHLY_PRICE_ID = 'pri_monthly'
  process.env.PADDLE_ANNUAL_PRICE_ID = 'pri_annual'
  delete process.env.PADDLE_PRODUCTION_API_KEY
  delete process.env.PADDLE_PRODUCTION_MONTHLY_PRICE_ID
  delete process.env.PADDLE_PRODUCTION_ANNUAL_PRICE_ID
}

async function invokeRoute(path, body = {}) {
  const layer = subscriptionsRouter.stack.find((entry) => entry.route?.path === path)
  assert.ok(layer, `${path} route exists`)

  const req = {
    path: `/api/subscriptions${path}`,
    headers: { authorization: 'Bearer valid-token' },
    cookies: {},
    body,
  }
  const res = createRes()

  jwt.verify = () => ({ userId: 123 })

  await new Promise((resolve, reject) => {
    layer.route.stack[0].handle(req, res, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  await layer.route.stack[1].handle(req, res, () => {})

  return res
}

function installDbMock(user) {
  const calls = []
  pool.query = async (sql, params) => {
    calls.push({ sql, params })

    if (String(sql).includes('FROM users')) {
      return { rows: user ? [user] : [] }
    }

    return { rows: [], rowCount: 1 }
  }
  return calls
}

function mutationCalls(calls) {
  return calls.filter(({ sql }) => String(sql).includes('UPDATE users') || String(sql).includes('INSERT INTO subscription_change_events'))
}

function mockPaddleResponse({ ok = true, status = 200, payload = { data: { id: 'sub_123' } } } = {}) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok,
      status,
      json: async () => payload,
    }
  }
  return calls
}

test('POST /api/subscriptions/change-plan rejects missing Paddle subscription ID without local mutation', async () => {
  resetPaddleEnv()
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: null,
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.payload, { error: BILLING_PROVIDER_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
})

test('POST /api/subscriptions/change-plan rejects missing target Paddle price ID without local mutation', async () => {
  resetPaddleEnv()
  delete process.env.PADDLE_ANNUAL_PRICE_ID
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.payload, { error: PADDLE_PRICE_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
})

test('POST /api/subscriptions/change-plan does not mutate locally when Paddle PATCH fails', async () => {
  resetPaddleEnv()
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleResponse({ ok: false, status: 400, payload: { error: 'bad request' } })

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.payload, { error: 'Unable to change plan' })
  assert.equal(mutationCalls(calls).length, 0)
})

test('POST /api/subscriptions/change-plan mutates locally after Paddle PATCH succeeds and preserves response shape', async () => {
  resetPaddleEnv()
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(typeof res.payload.message, 'string')
  assert.equal(typeof res.payload.effectiveAt, 'string')
  assert.equal(res.payload.proratedCreditCents, 1500)
  assert.equal(paddleCalls.length, 1)
  assert.equal(mutationCalls(calls).filter(({ sql }) => String(sql).includes('UPDATE users')).length, 1)
  assert.equal(mutationCalls(calls).filter(({ sql }) => String(sql).includes('INSERT INTO subscription_change_events')).length, 1)
  assert.ok(calls.some(({ sql }) => sql === 'BEGIN'))
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'))
})

test('POST /api/subscriptions/cancel rejects missing Paddle subscription ID without local mutation', async () => {
  resetPaddleEnv()
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: null,
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/cancel', { reason: 'too expensive' })

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.payload, { error: BILLING_PROVIDER_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
})

test('POST /api/subscriptions/cancel does not mutate locally when Paddle cancel fails', async () => {
  resetPaddleEnv()
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleResponse({ ok: false, status: 500, payload: { error: 'paddle unavailable' } })

  const res = await invokeRoute('/cancel', { reason: 'too expensive' })

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.payload, { error: 'Unable to cancel subscription' })
  assert.equal(mutationCalls(calls).length, 0)
})

test('POST /api/subscriptions/cancel mutates locally after Paddle cancel succeeds and preserves response shape', async () => {
  resetPaddleEnv()
  const calls = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/cancel', { reason: 'too expensive', acceptOffer: false })

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(typeof res.payload.message, 'string')
  assert.equal(res.payload.effectiveAt, '2026-07-01T00:00:00.000Z')
  assert.equal(paddleCalls.length, 1)
  assert.equal(mutationCalls(calls).filter(({ sql }) => String(sql).includes('UPDATE users')).length, 1)
  assert.equal(mutationCalls(calls).filter(({ sql }) => String(sql).includes('INSERT INTO subscription_change_events')).length, 1)
  assert.ok(calls.some(({ sql }) => sql === 'BEGIN'))
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'))
})
