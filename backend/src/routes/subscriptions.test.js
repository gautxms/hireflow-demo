import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

import subscriptionsRouter from './subscriptions.js'
import { pool } from '../db/client.js'

const BILLING_PROVIDER_MISSING_ERROR = 'Subscription cannot be changed because billing provider subscription is missing. Please contact support.'
const PADDLE_PRICE_MISSING_ERROR = 'Subscription cannot be changed because billing configuration is missing. Please contact support.'

const originalQuery = pool.query
const originalConnect = pool.connect
const originalFetch = globalThis.fetch
const originalVerify = jwt.verify
const originalEnv = { ...process.env }
const originalConsoleInfo = console.info

after(async () => {
  pool.query = originalQuery
  pool.connect = originalConnect
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
  delete process.env.PADDLE_SANDBOX_API_BASE_URL
  delete process.env.PADDLE_SANDBOX_API_KEY
  delete process.env.PADDLE_SANDBOX_CLIENT_TOKEN
  delete process.env.PADDLE_SANDBOX_MONTHLY_PRICE_ID
  delete process.env.PADDLE_SANDBOX_ANNUAL_PRICE_ID
  delete process.env.PADDLE_ENABLE_TEST_UPGRADE
  delete process.env.PADDLE_TEST_UPGRADE_KEY
  delete process.env.PADDLE_TEST_ANNUAL_PRICE_ID
  delete process.env.PADDLE_TEST_MONTHLY_PRICE_ID
}

function activeMonthlyUser() {
  return {
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  }
}

function activeAnnualUser() {
  return {
    ...activeMonthlyUser(),
    subscription_plan: 'annual',
  }
}

function enableTestUpgrade() {
  process.env.PADDLE_ENABLE_TEST_UPGRADE = 'true'
  process.env.PADDLE_TEST_UPGRADE_KEY = 'upgrade-secret'
  process.env.PADDLE_TEST_ANNUAL_PRICE_ID = 'pri_test_annual'
  process.env.PADDLE_TEST_MONTHLY_PRICE_ID = 'pri_test_monthly'
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
  const connectCalls = []

  pool.connect = async () => {
    connectCalls.push({ unexpected: true })
    throw new Error('pool.connect should not be called')
  }

  pool.query = async (sql, params) => {
    calls.push({ sql, params })

    if (String(sql).includes('FROM users')) {
      return { rows: user ? [user] : [] }
    }

    return { rows: [], rowCount: 1 }
  }

  return { calls, connectCalls }
}

function installClientMock({ failOn } = {}) {
  const clientCalls = []
  const client = {
    async query(sql, params) {
      clientCalls.push({ sql, params, client })

      if (failOn && String(sql).includes(failOn)) {
        throw new Error(`client failure on ${failOn}`)
      }

      return { rows: [], rowCount: 1 }
    },
    release() {
      clientCalls.push({ sql: 'RELEASE', client })
    },
  }
  const connectCalls = []

  pool.connect = async () => {
    connectCalls.push(client)
    return client
  }

  return { client, clientCalls, connectCalls }
}

function assertTransactionSequence(clientCalls, updatePattern, { includesProjection = false } = {}) {
  assert.equal(clientCalls.length, includesProjection ? 6 : 5)
  assert.equal(clientCalls[0].sql, 'BEGIN')
  assert.match(String(clientCalls[1].sql), updatePattern)
  if (includesProjection) assert.match(String(clientCalls[2].sql), /INSERT INTO subscriptions/)
  assert.match(String(clientCalls[includesProjection ? 3 : 2].sql), /INSERT INTO subscription_change_events/)
  assert.equal(clientCalls[includesProjection ? 4 : 3].sql, 'COMMIT')
  assert.equal(clientCalls[includesProjection ? 5 : 4].sql, 'RELEASE')
}

function assertRollbackSequence(clientCalls) {
  assert.equal(clientCalls.at(-2).sql, 'ROLLBACK')
  assert.equal(clientCalls.at(-1).sql, 'RELEASE')
  assert.ok(!clientCalls.some(({ sql }) => sql === 'COMMIT'))
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
      headers: { get: () => null },
      json: async () => payload,
    }
  }
  return calls
}

function mockPaddleSequence(responses) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    const response = responses[Math.min(calls.length - 1, responses.length - 1)] || {}
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: { get: (name) => response.headers?.[name] || null },
      json: async () => response.payload ?? { data: { id: 'sub_123' } },
    }
  }
  return calls
}

function errorLogCalls(calls) {
  return calls.filter(({ sql }) => String(sql).includes('INSERT INTO error_logs'))
}





test('GET /api/subscriptions/current returns cancelAtPeriodEnd true when future cancellation_effective_at and cancellation status exist', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    subscription_status: 'cancelled',
    paddle_customer_id: 'ctm_123',
    cancellation_effective_at: '2027-01-07T00:00:00.000Z',
  })
  mockPaddleResponse()

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.cancellationEffectiveAt, '2027-01-07T00:00:00.000Z')
  assert.equal(res.payload.subscription.cancelAtPeriodEnd, true)
  assert.equal(res.payload.subscription.latestRecordStatus, 'cancellation_scheduled')
})


test('GET /api/subscriptions/current returns cancelAtPeriodEnd false for active stale future cancellation_effective_at without schedule signal', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
    cancellation_effective_at: '2027-01-07T00:00:00.000Z',
  })
  mockPaddleResponse({ payload: { data: { id: 'sub_123', status: 'active' } } })

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.status, 'active')
  assert.equal(res.payload.subscription.cancellationEffectiveAt, '2027-01-07T00:00:00.000Z')
  assert.equal(res.payload.subscription.cancelAtPeriodEnd, false)
  assert.equal(res.payload.subscription.latestRecordStatus, null)
})

test('GET /api/subscriptions/current returns cancelAtPeriodEnd true when Paddle scheduled_change proves cancellation', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
    cancellation_effective_at: '2027-01-07T00:00:00.000Z',
  })
  mockPaddleResponse({ payload: { data: { id: 'sub_123', status: 'active', scheduled_change: { action: 'cancel', effective_at: '2027-01-07T00:00:00.000Z' } } } })

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.cancelAtPeriodEnd, true)
})

test('GET /api/subscriptions/current does not return cancelAtPeriodEnd true when cancellation_effective_at is missing or past', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
    cancellation_effective_at: '2020-01-07T00:00:00.000Z',
  })
  mockPaddleResponse()

  const pastRes = await invokeRoute('/current')

  assert.equal(pastRes.statusCode, 200)
  assert.equal(pastRes.payload.subscription.cancelAtPeriodEnd, false)

  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
    cancellation_effective_at: null,
  })
  mockPaddleResponse()

  const missingRes = await invokeRoute('/current')

  assert.equal(missingRes.statusCode, 200)
  assert.equal(missingRes.payload.subscription.cancellationEffectiveAt, null)
  assert.equal(missingRes.payload.subscription.cancelAtPeriodEnd, false)
})

test('GET /api/subscriptions/current removes stale renewal and payment metadata for a fully canceled subscription', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    subscription_status: 'cancelled',
    paddle_customer_id: 'ctm_123',
    cancellation_effective_at: '2020-01-07T00:00:00.000Z',
    subscription_renewal_date: '2020-01-07T00:00:00.000Z',
    next_billing_date: '2020-01-07T00:00:00.000Z',
    payment_method_brand: 'Visa',
    payment_method_last4: '4242',
  })
  mockPaddleResponse({ payload: { data: { id: 'sub_123', status: 'canceled' } } })

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.status, 'cancelled')
  assert.equal(res.payload.subscription.renewalDate, null)
  assert.equal(res.payload.subscription.nextBillingDate, null)
  assert.equal(res.payload.subscription.paymentMethod, null)
  assert.equal(res.payload.subscription.cancellationEffectiveAt, '2020-01-07T00:00:00.000Z')
})

test('GET /api/subscriptions/current returns Paddle actual annual INR price for gated test annual price', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_test_annual', billing_cycle: { interval: 'year' }, unit_price: { amount: '40000', currency_code: 'INR' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.plan, 'annual')
  assert.equal(res.payload.subscription.costFormatted, '₹400.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'INR')
  assert.equal(res.payload.subscription.costSource, 'paddle')
  assert.equal(res.payload.subscription.billingInterval, 'year')
  assert.equal(paddleCalls.length, 1)
  assert.match(paddleCalls[0].url, /\/subscriptions\/sub_123$/)
})


test('GET /api/subscriptions/current returns Paddle actual monthly INR price for gated test monthly price', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock({
    ...activeMonthlyUser(),
    paddle_customer_id: 'ctm_123',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_test_monthly', billing_cycle: { interval: 'month' }, unit_price: { amount: '10000', currency_code: 'INR' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.plan, 'monthly')
  assert.equal(res.payload.subscription.costFormatted, '₹100.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'INR')
  assert.equal(res.payload.subscription.costSource, 'paddle')
  assert.equal(res.payload.subscription.billingInterval, 'month')
  assert.equal(paddleCalls.length, 1)
  assert.match(paddleCalls[0].url, /\/subscriptions\/sub_123$/)
})

test('GET /api/subscriptions/current returns Paddle actual canonical annual USD price', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_annual', billing_cycle: { interval: 'year' }, unit_price: { amount: '99900', currency_code: 'USD' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.costFormatted, '$999.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'USD')
  assert.equal(res.payload.subscription.costSource, 'paddle')
  assert.equal(res.payload.subscription.billingInterval, 'year')
})

test('GET /api/subscriptions/current formats zero-decimal Paddle annual JPY price without dividing by 100', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_annual', billing_cycle: { interval: 'year' }, unit_price: { amount: '9900', currency_code: 'JPY' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.costFormatted, '¥9,900')
  assert.equal(res.payload.subscription.costCurrencyCode, 'JPY')
  assert.equal(res.payload.subscription.costSource, 'paddle')
  assert.equal(res.payload.subscription.billingInterval, 'year')
})

test('GET /api/subscriptions/current falls back to PLAN_CONFIG if Paddle subscription fetch fails', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
  })
  mockPaddleResponse({ ok: false, status: 502, payload: { error: { code: 'upstream_error' } } })

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.costFormatted, '$999.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'USD')
  assert.equal(res.payload.subscription.costSource, 'local_fallback')
  assert.equal(res.payload.subscription.billingInterval, 'year')
})

test('GET /api/subscriptions/current falls back when Paddle item currency is missing', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_annual', billing_cycle: { interval: 'year' }, unit_price: { amount: '99900' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.costFormatted, '$999.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'USD')
  assert.equal(res.payload.subscription.costSource, 'local_fallback')
})

test('GET /api/subscriptions/current falls back when Paddle item amount is missing', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeAnnualUser(),
    paddle_customer_id: 'ctm_123',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_annual', billing_cycle: { interval: 'year' }, unit_price: { currency_code: 'USD' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.costFormatted, '$999.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'USD')
  assert.equal(res.payload.subscription.costSource, 'local_fallback')
})

test('GET /api/subscriptions/current keeps local pricing for users without Paddle subscription', async () => {
  resetPaddleEnv()
  installDbMock({
    ...activeMonthlyUser(),
    paddle_subscription_id: null,
    paddle_customer_id: null,
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.costFormatted, '$99.00')
  assert.equal(res.payload.subscription.costCurrencyCode, 'USD')
  assert.equal(res.payload.subscription.costSource, 'local_fallback')
  assert.equal(res.payload.subscription.billingInterval, 'month')
  assert.equal(paddleCalls.length, 0)
})

test('GET /api/subscriptions/current repairs mismatched renewal dates from Paddle', async () => {
  resetPaddleEnv()
  const user = {
    ...activeAnnualUser(),
    subscription_renewal_date: '2026-08-20T00:00:00.000Z',
    next_billing_date: '2027-07-21T00:00:00.000Z',
  }
  const { calls } = installDbMock(user)
  mockPaddleResponse({ payload: { data: {
    id: 'sub_123',
    status: 'active',
    items: [{ price: { id: 'pri_annual', billing_cycle: { interval: 'year' }, unit_price: { amount: '99900', currency_code: 'USD' } } }],
    current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' },
    next_billed_at: '2027-07-21T00:00:00.000Z',
  } } })

  const res = await invokeRoute('/current')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.subscription.renewalDate, '2027-07-21T00:00:00.000Z')
  assert.equal(res.payload.subscription.nextBillingDate, '2027-07-21T00:00:00.000Z')
  const repair = calls.find(({ sql }) => String(sql).includes('subscription_renewal_date = $2'))
  assert.ok(repair)
  assert.deepEqual(repair.params, [123, '2027-07-21T00:00:00.000Z', '2027-07-21T00:00:00.000Z'])
})

test('POST /api/subscriptions/change-plan-preview uses gated test annual price for valid upgradeTestKey', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  const { calls, connectCalls } = installDbMock(activeMonthlyUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', immediate_transaction: { details: { totals: { total: '100', currency_code: 'USD' } } }, next_transaction: { details: { totals: { total: '1200', currency_code: 'USD' } } } } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual', upgradeTestKey: 'upgrade-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_test_annual', quantity: 1 }])
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan uses gated test annual price for valid upgradeTestKey', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeMonthlyUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_test_annual' } }], current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' }, next_billed_at: '2027-07-21T00:00:00.000Z' } } },
  ])
  installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual', upgradeTestKey: 'upgrade-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_test_annual', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses normal annual price when upgradeTestKey is missing', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeMonthlyUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_annual', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses normal annual price when upgradeTestKey is wrong', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeMonthlyUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual', upgradeTestKey: 'wrong-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_annual', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses normal annual price when test upgrade is disabled', async () => {
  resetPaddleEnv()
  process.env.PADDLE_ENABLE_TEST_UPGRADE = 'false'
  process.env.PADDLE_TEST_UPGRADE_KEY = 'upgrade-secret'
  process.env.PADDLE_TEST_ANNUAL_PRICE_ID = 'pri_test_annual'
  installDbMock(activeMonthlyUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual', upgradeTestKey: 'upgrade-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_annual', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan uses gated test monthly price for valid upgradeTestKey downgrade', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeAnnualUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual', billing_cycle: { interval: 'year' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', current_billing_period: { ends_at: '2026-08-01T00:00:00.000Z' } } } },
  ])
  installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'monthly', upgradeTestKey: 'upgrade-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_test_monthly', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses gated test monthly price for valid upgradeTestKey downgrade', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeAnnualUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_test_annual', billing_cycle: { interval: 'year' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'monthly', upgradeTestKey: 'upgrade-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_test_monthly', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses normal monthly price when upgradeTestKey is missing', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeAnnualUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_test_annual', billing_cycle: { interval: 'year' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'monthly' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_monthly', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses normal monthly price when test upgrade is disabled', async () => {
  resetPaddleEnv()
  process.env.PADDLE_ENABLE_TEST_UPGRADE = 'false'
  process.env.PADDLE_TEST_UPGRADE_KEY = 'upgrade-secret'
  process.env.PADDLE_TEST_MONTHLY_PRICE_ID = 'pri_test_monthly'
  installDbMock(activeAnnualUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual', billing_cycle: { interval: 'year' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'monthly', upgradeTestKey: 'upgrade-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_monthly', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview uses normal monthly price when upgradeTestKey is wrong', async () => {
  resetPaddleEnv()
  enableTestUpgrade()
  installDbMock(activeAnnualUser())
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_test_annual', billing_cycle: { interval: 'year' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'monthly', upgradeTestKey: 'wrong-secret' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_monthly', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan-preview returns Paddle preview without local mutation', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const previewPayload = {
    data: {
      id: 'sub_123',
      immediate_transaction: { id: 'txn_now', details: { totals: { total: '2500', currency_code: 'USD' } } },
      next_transaction: { id: 'txn_next', details: { totals: { total: '99900', currency_code: 'USD' } }, billing_period: { starts_at: '2026-07-02T00:00:00.000Z' } },
    },
  }
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
    { payload: previewPayload },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(res.payload.currentPlan, 'monthly')
  assert.equal(res.payload.targetPlan, 'annual')
  assert.equal(res.payload.immediateAmountFormatted, '$25.00')
  assert.equal(res.payload.nextBillingAmountFormatted, '$999.00')
  assert.equal(res.payload.previewCurrencyCode, 'USD')
  assert.equal(res.payload.hasVerifiedPreviewAmounts, true)
  assert.equal(res.payload.immediateTransaction, undefined)
  assert.equal(res.payload.nextTransaction, undefined)
  assert.equal(paddleCalls.length, 2)
  assert.match(paddleCalls[1].url, /\/subscriptions\/sub_123\/preview$/)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

async function assertPreviewNormalization({ immediateTransaction, nextTransaction, expected }) {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', immediate_transaction: immediateTransaction, next_transaction: nextTransaction } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(res.payload[key], value)
  }
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
}

test('POST /api/subscriptions/change-plan-preview formats INR preview as INR, not USD', async () => {
  await assertPreviewNormalization({
    immediateTransaction: { details: { totals: { total: '7192126', currency_code: 'INR' } } },
    nextTransaction: { details: { totals: { total: '7200000', currency_code: 'INR' } } },
    expected: {
      immediateAmountFormatted: '₹71,921.26',
      nextBillingAmountFormatted: '₹72,000.00',
      previewCurrencyCode: 'INR',
      hasVerifiedPreviewAmounts: true,
    },
  })
})

test('POST /api/subscriptions/change-plan-preview prefers Paddle formatted totals', async () => {
  await assertPreviewNormalization({
    immediateTransaction: { details: { totals: { total: '2500', currency_code: 'USD' }, formatted_totals: { total: 'US$25.00 from Paddle' } } },
    nextTransaction: { details: { totals: { total: '99900', currency_code: 'USD' }, formatted_totals: { total: 'US$999.00 from Paddle' } } },
    expected: {
      immediateAmountFormatted: 'US$25.00 from Paddle',
      nextBillingAmountFormatted: 'US$999.00 from Paddle',
      hasVerifiedPreviewAmounts: true,
    },
  })
})

test('POST /api/subscriptions/change-plan-preview marks preview unverified when currency is missing', async () => {
  await assertPreviewNormalization({
    immediateTransaction: { details: { totals: { total: '2500' } } },
    nextTransaction: { details: { totals: { total: '99900' } } },
    expected: {
      immediateAmountFormatted: null,
      nextBillingAmountFormatted: null,
      previewCurrencyCode: null,
      hasVerifiedPreviewAmounts: false,
    },
  })
})

test('POST /api/subscriptions/change-plan-preview marks preview unverified when total is missing', async () => {
  await assertPreviewNormalization({
    immediateTransaction: { details: { totals: { currency_code: 'USD' } } },
    nextTransaction: { details: { totals: { currency_code: 'USD' } } },
    expected: {
      immediateAmountFormatted: null,
      nextBillingAmountFormatted: null,
      previewCurrencyCode: 'USD',
      hasVerifiedPreviewAmounts: false,
    },
  })
})

test('POST /api/subscriptions/change-plan-preview displays large valid Paddle amounts with detected currency', async () => {
  await assertPreviewNormalization({
    immediateTransaction: { details: { totals: { total: '7192126', currency_code: 'USD' } } },
    nextTransaction: { details: { totals: { total: '7200000', currency_code: 'USD' } } },
    expected: {
      immediateAmountFormatted: '$71,921.26',
      nextBillingAmountFormatted: '$72,000.00',
      previewCurrencyCode: 'USD',
      hasVerifiedPreviewAmounts: true,
    },
  })
})

test('POST /api/subscriptions/change-plan-preview rejects missing Paddle subscription ID without Paddle or mutation', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: null,
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.payload, { code: 'BILLING_PROVIDER_MISSING', error: BILLING_PROVIDER_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan-preview rejects missing target Paddle price ID without preview or mutation', async () => {
  resetPaddleEnv()
  delete process.env.PADDLE_ANNUAL_PRICE_ID
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.payload, { code: 'BILLING_CONFIG_MISSING', error: PADDLE_PRICE_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan-preview classifies Paddle validation failure safely and logs context', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
    { ok: false, status: 422, headers: { 'request-id': 'req_validation' }, payload: { error: { code: 'validation_error' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 502)
  assert.deepEqual(res.payload, { code: 'PADDLE_SUBSCRIPTION_UPDATE_FAILED', error: 'Paddle could not update your subscription right now. Please try again or contact support if this continues.' })
  assert.equal(paddleCalls.length, 2)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
  const [logCall] = errorLogCalls(calls)
  assert.ok(logCall)
  assert.equal(logCall.params[0], 'subscriptions.change-plan-preview.failed')
  const context = JSON.parse(logCall.params[3])
  assert.equal(context.code, 'PADDLE_SUBSCRIPTION_UPDATE_FAILED')
  assert.equal(context.paddleStatus, 422)
  assert.equal(context.paddleRequestId, 'req_validation')
  assert.equal(context.paddleErrorCode, 'validation_error')
  assert.equal(context.targetPlan, 'annual')
  assert.equal(context.userId, 123)
})

test('POST /api/subscriptions/change-plan-preview rejects invalid targetPlan without Paddle or mutation', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'weekly' })

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.payload, { code: 'PLAN_CHANGE_NOT_ALLOWED', error: 'This plan change is not available for your subscription. Please contact support.' })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan rejects missing Paddle subscription ID without local mutation or client checkout', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
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
  assert.deepEqual(res.payload, { code: 'BILLING_PROVIDER_MISSING', error: BILLING_PROVIDER_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan rejects missing target Paddle price ID without local mutation or client checkout', async () => {
  resetPaddleEnv()
  delete process.env.PADDLE_ANNUAL_PRICE_ID
  const { calls, connectCalls } = installDbMock({
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
  assert.deepEqual(res.payload, { code: 'BILLING_CONFIG_MISSING', error: PADDLE_PRICE_MISSING_ERROR })
  assert.equal(paddleCalls.length, 0)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan does not checkout client or mutate locally when Paddle PATCH fails', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleResponse({ ok: false, status: 400, payload: { error: 'bad request' } })

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 502)
  assert.deepEqual(res.payload, { code: 'PADDLE_SUBSCRIPTION_UPDATE_FAILED', error: 'Paddle could not update your subscription right now. Please try again or contact support if this continues.' })
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})


test('POST /api/subscriptions/change-plan reports unresolved recovery when Paddle cannot be read after a 402 failure', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
    { ok: false, status: 402, payload: { error: { code: 'payment_required' } } },
  ])

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 500)
  assert.equal(res.payload.code, 'PLAN_CHANGE_RECOVERY_FAILED')
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan reports unresolved recovery when Paddle cannot be read after payment action is required', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
    { ok: false, status: 422, payload: { error: { code: 'payment_method_action_required' } } },
  ])

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 500)
  assert.equal(res.payload.code, 'PLAN_CHANGE_RECOVERY_FAILED')
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan restores Monthly when Paddle applies a failed Annual upgrade', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    ...activeMonthlyUser(),
    current_period_end: '2026-08-20T00:00:00.000Z',
    next_billing_date: '2026-08-20T00:00:00.000Z',
    subscription_renewal_date: '2026-08-20T00:00:00.000Z',
  })
  const recoveredCustomData = {
    userId: 123,
    plan: 'monthly',
    hireflowPlanChange: {
      fromPlan: 'monthly',
      toPlan: 'annual',
      priorStatus: 'active',
      priorCurrentPeriodEnd: '2026-08-20T00:00:00.000Z',
      priorNextBillingDate: '2026-08-20T00:00:00.000Z',
      priorRenewalDate: '2026-08-20T00:00:00.000Z',
      previousItems: [{ price_id: 'pri_monthly', quantity: 1 }],
      outcome: 'recovered',
    },
  }
  const paddleCalls = mockPaddleSequence([
    { payload: { data: {
      id: 'sub_123',
      status: 'active',
      custom_data: { userId: 123, plan: 'monthly' },
      items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }],
    } } },
    { ok: false, status: 400, payload: { error: { code: 'card_declined' } } },
    { payload: { data: {
      id: 'sub_123',
      status: 'past_due',
      custom_data: { userId: 123, plan: 'annual' },
      items: [{ price: { id: 'pri_annual', billing_cycle: { interval: 'year' } }, quantity: 1 }],
    } } },
    { payload: { data: [{ id: 'txn_failed_upgrade', status: 'past_due', origin: 'subscription_update', created_at: new Date().toISOString() }] } },
    { payload: { data: { id: 'txn_failed_upgrade', status: 'canceled' } } },
    { payload: { data: { id: 'sub_123', status: 'past_due', custom_data: { userId: 123, plan: 'annual' } } } },
    { payload: { data: { id: 'sub_123', status: 'active', custom_data: recoveredCustomData, items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', custom_data: recoveredCustomData, items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } } },
  ])

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 402)
  assert.deepEqual(res.payload, {
    code: 'PLAN_CHANGE_PAYMENT_FAILED_PRESERVED',
    error: 'The upgrade payment was declined. Your current plan and access remain unchanged.',
  })
  assert.equal(connectCalls.length, 0)

  const updateRequest = JSON.parse(paddleCalls[1].options.body)
  assert.equal(updateRequest.on_payment_failure, 'prevent_change')
  assert.equal(updateRequest.custom_data.hireflowPlanChange.fromPlan, 'monthly')
  assert.equal(updateRequest.custom_data.hireflowPlanChange.toPlan, 'annual')
  assert.deepEqual(updateRequest.custom_data.hireflowPlanChange.previousItems, [{ price_id: 'pri_monthly', quantity: 1 }])

  const cancelRequest = paddleCalls.find(({ url, options }) => url.endsWith('/transactions/txn_failed_upgrade') && options.method === 'PATCH')
  assert.deepEqual(JSON.parse(cancelRequest.options.body), { status: 'canceled' })

  const restoreRequest = paddleCalls.find(({ url, options }) => url.endsWith('/subscriptions/sub_123')
    && options.method === 'PATCH'
    && JSON.parse(options.body).proration_billing_mode === 'do_not_bill')
  assert.deepEqual(JSON.parse(restoreRequest.options.body).items, [{ price_id: 'pri_monthly', quantity: 1 }])

  const restoreLocal = calls.find(({ sql, params }) => String(sql).includes('UPDATE users') && params?.[0] === 'monthly' && params?.[1] === 'active')
  assert.ok(restoreLocal)
  assert.equal(restoreLocal.params[2], '2026-08-20T00:00:00.000Z')
})

test('POST /api/subscriptions/change-plan leaves local entitlement unchanged when failed upgrade recovery cannot match a transaction', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    ...activeMonthlyUser(),
    current_period_end: '2026-08-20T00:00:00.000Z',
  })
  mockPaddleSequence([
    { payload: { data: {
      id: 'sub_123',
      status: 'active',
      custom_data: { userId: 123, plan: 'monthly' },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    } } },
    { ok: false, status: 400, payload: { error: { code: 'card_declined' } } },
    { payload: { data: {
      id: 'sub_123',
      status: 'past_due',
      custom_data: { userId: 123, plan: 'annual' },
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    } } },
    { payload: { data: [] } },
  ])

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.payload, {
    code: 'PLAN_CHANGE_RECOVERY_FAILED',
    error: 'Unable to confirm that your current plan was restored. Reload Billing to check the latest status before trying again.',
  })
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan keeps downgrade visible plan current and marks pendingPlan in response', async () => {
  resetPaddleEnv()
  const { calls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'annual',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [{ price: { id: 'pri_annual' }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', current_billing_period: { ends_at: '2026-07-01T00:00:00.000Z' } } } },
  ])
  const { clientCalls } = installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'monthly' })

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.pendingPlan, 'monthly')
  assert.match(res.payload.message, /current plan stays active/i)
  assert.equal(JSON.parse(paddleCalls[1].options.body).proration_billing_mode, 'prorated_next_billing_period')
  assert.deepEqual(clientCalls[1].params, ['annual', 'active', 'sub_123', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 123])
  assert.equal(mutationCalls(calls).length, 0)
})

test('POST /api/subscriptions/change-plan uses one checked-out client after Paddle PATCH succeeds', async () => {
  resetPaddleEnv()
  const { calls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual' } }], current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' }, next_billed_at: '2027-07-21T00:00:00.000Z' } } },
  ])
  const { clientCalls, connectCalls } = installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(typeof res.payload.message, 'string')
  assert.equal(typeof res.payload.effectiveAt, 'string')
  assert.equal(res.payload.pendingPlan, null)
  assert.equal(paddleCalls.length, 2)
  assert.match(paddleCalls[0].url, /\/subscriptions\/sub_123$/)
  assert.match(paddleCalls[1].url, /\/subscriptions\/sub_123$/)
  assert.equal(JSON.parse(paddleCalls[1].options.body).on_payment_failure, 'prevent_change')
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 1)
  assertTransactionSequence(clientCalls, /UPDATE users/, { includesProjection: true })
  assert.match(clientCalls[1].sql, /subscription_renewal_date = COALESCE\(\$4, subscription_renewal_date\)/)
  assert.deepEqual(clientCalls[1].params.slice(0, 5), [
    'annual',
    'active',
    'sub_123',
    '2027-07-21T00:00:00.000Z',
    '2027-07-21T00:00:00.000Z',
  ])
})

test('POST /api/subscriptions/keep-subscription removes Paddle scheduled cancellation without a charge', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    paddle_environment: 'production',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00.000Z' } } } },
    { payload: { data: { id: 'sub_123', status: 'active', scheduled_change: null, next_billed_at: '2026-08-01T00:00:00.000Z', current_billing_period: { ends_at: '2026-08-01T00:00:00.000Z' } } } },
  ])
  const { clientCalls } = installClientMock()

  const res = await invokeRoute('/keep-subscription')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(res.payload.subscription.status, 'active')
  assert.equal(res.payload.subscription.cancellationEffectiveAt, null)
  assert.equal(paddleCalls.length, 2)
  assert.equal(paddleCalls[1].options.method, 'PATCH')
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body), { scheduled_change: null })
  assertTransactionSequence(clientCalls, /cancellation_effective_at = NULL/)
})

test('POST /api/subscriptions/keep-subscription reconciles local state when Paddle already removed cancellation', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    subscription_status: 'active',
    subscription_plan: 'annual',
    paddle_subscription_id: 'sub_123',
    paddle_environment: 'production',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', scheduled_change: null, next_billed_at: '2027-08-01T00:00:00.000Z' } } },
  ])
  const { clientCalls } = installClientMock()

  const res = await invokeRoute('/keep-subscription')

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(res.payload.subscription.cancellationEffectiveAt, null)
  assert.equal(paddleCalls.length, 1)
  assertTransactionSequence(clientCalls, /cancellation_effective_at = NULL/)
  const metadata = JSON.parse(clientCalls[2].params[2])
  assert.equal(metadata.provider_schedule_already_clear, true)
})

test('POST /api/subscriptions/keep-subscription reports sync pending when Paddle succeeds before a local database failure', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    subscription_status: 'active',
    subscription_plan: 'annual',
    paddle_subscription_id: 'sub_123',
    paddle_environment: 'production',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', scheduled_change: { action: 'cancel', effective_at: '2027-08-01T00:00:00.000Z' } } } },
    { payload: { data: { id: 'sub_123', status: 'active', scheduled_change: null } } },
  ])
  const { clientCalls } = installClientMock({ failOn: 'INSERT INTO subscription_change_events' })

  const res = await invokeRoute('/keep-subscription')

  assert.equal(res.statusCode, 202)
  assert.equal(res.payload.status, 'syncing')
  assert.equal(res.payload.code, 'KEEP_SUBSCRIPTION_SYNC_PENDING')
  assert.match(res.payload.message, /subscription will continue/i)
  assert.equal(paddleCalls.length, 2)
  assertRollbackSequence(clientCalls)
})

test('POST /api/subscriptions/keep-subscription sends fully ended users to a new paid checkout', async () => {
  resetPaddleEnv()
  const { connectCalls } = installDbMock({
    id: 123,
    subscription_status: 'cancelled',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
  })
  mockPaddleResponse({ payload: { data: { id: 'sub_123', status: 'canceled', scheduled_change: null } } })

  const res = await invokeRoute('/keep-subscription')

  assert.equal(res.statusCode, 409)
  assert.equal(res.payload.code, 'SUBSCRIPTION_ALREADY_ENDED')
  assert.equal(res.payload.redirectTo, '/pricing?reason=subscribe_again')
  assert.equal(connectCalls.length, 0)
})



test('POST /api/subscriptions/change-plan-preview blocks mixed-interval recurring add-on without Paddle preview or mutation', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [
      { price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 },
      { price: { id: 'pri_monthly_addon', billing_cycle: { interval: 'month' } }, quantity: 2 },
    ] } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.equal(res.payload.code, 'UNSUPPORTED_BILLING_ITEMS')
  assert.match(res.payload.error, /recurring add-ons/i)
  assert.equal(paddleCalls.length, 1)
  assert.doesNotMatch(paddleCalls[0].url, /preview$/)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan blocks mixed-interval recurring add-on without Paddle update or mutation', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [
      { price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 },
      { price: { id: 'pri_monthly_addon', billing_cycle: { interval: 'month' } }, quantity: 2 },
    ] } } },
  ])

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.equal(res.payload.code, 'UNSUPPORTED_BILLING_ITEMS')
  assert.equal(paddleCalls.length, 1)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan preserves non-recurring unrelated item safely', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [
      { price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 },
      { price: { id: 'pri_setup_fee' }, quantity: 1 },
    ] } } },
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual' } }], current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' }, next_billed_at: '2027-07-21T00:00:00.000Z' } } },
  ])
  installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  const patchBody = JSON.parse(paddleCalls[1].options.body)
  assert.deepEqual(patchBody.items, [
    { price_id: 'pri_annual', quantity: 1 },
    { price_id: 'pri_setup_fee', quantity: 1 },
  ])
})

test('POST /api/subscriptions/change-plan preserves unrelated Paddle items and quantity', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', items: [
      { price: { id: 'pri_monthly' }, quantity: 3 },
      { price: { id: 'pri_addon' }, quantity: 2 },
    ] } } },
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual' } }], current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' }, next_billed_at: '2027-07-21T00:00:00.000Z' } } },
  ])
  installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  const patchBody = JSON.parse(paddleCalls[1].options.body)
  assert.deepEqual(patchBody.items, [
    { price_id: 'pri_annual', quantity: 3 },
    { price_id: 'pri_addon', quantity: 2 },
  ])
  assert.equal(patchBody.proration_billing_mode, 'prorated_immediately')
  assert.equal(patchBody.on_payment_failure, 'prevent_change')
})

test('POST /api/subscriptions/change-plan rolls back and releases checked-out client on local DB failure', async () => {
  resetPaddleEnv()
  const { calls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual' } }], current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' }, next_billed_at: '2027-07-21T00:00:00.000Z' } } },
  ])
  const { clientCalls, connectCalls } = installClientMock({ failOn: 'INSERT INTO subscription_change_events' })

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.payload, { code: 'UNKNOWN', error: 'Unable to change plan' })
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 1)
  assertRollbackSequence(clientCalls)
})

test('POST /api/subscriptions/cancel rejects missing Paddle subscription ID without local mutation or client checkout', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
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
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/cancel does not checkout client or mutate locally when Paddle cancel fails', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
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
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/cancel uses one checked-out client after Paddle cancel succeeds', async () => {
  resetPaddleEnv()
  const { calls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()
  const { clientCalls, connectCalls } = installClientMock()

  const res = await invokeRoute('/cancel', { reason: 'too expensive', acceptOffer: false })

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'ok')
  assert.equal(typeof res.payload.message, 'string')
  assert.equal(res.payload.effectiveAt, '2026-07-01T00:00:00.000Z')
  assert.equal(paddleCalls.length, 1)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 1)
  assertTransactionSequence(clientCalls, /UPDATE users/)
  assert.equal(clientCalls[1].params[0], 'active', 'scheduled cancellation keeps the locally active status')
})

test('POST /api/subscriptions/cancel routes an explicitly sandbox user to the sandbox API', async () => {
  resetPaddleEnv()
  process.env.PADDLE_SANDBOX_API_BASE_URL = 'https://sandbox-api.paddle.test'
  process.env.PADDLE_SANDBOX_API_KEY = 'sandbox-key'
  process.env.PADDLE_SANDBOX_CLIENT_TOKEN = 'sandbox-token'
  process.env.PADDLE_SANDBOX_MONTHLY_PRICE_ID = 'pri_sandbox_monthly'
  process.env.PADDLE_SANDBOX_ANNUAL_PRICE_ID = 'pri_sandbox_annual'

  installDbMock({
    id: 123,
    email: 'sandbox-user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_sandbox_123',
    paddle_environment: 'sandbox',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleResponse()
  installClientMock()

  const res = await invokeRoute('/cancel', { reason: 'sandbox verification' })

  assert.equal(res.statusCode, 200)
  assert.equal(paddleCalls.length, 1)
  assert.equal(paddleCalls[0].url, 'https://sandbox-api.paddle.test/subscriptions/sub_sandbox_123/cancel')
  assert.equal(paddleCalls[0].options.headers.Authorization, 'Bearer sandbox-key')
})

test('POST /api/subscriptions/cancel rolls back and releases checked-out client on local DB failure', async () => {
  resetPaddleEnv()
  const { calls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  mockPaddleResponse()
  const { clientCalls, connectCalls } = installClientMock({ failOn: 'INSERT INTO subscription_change_events' })

  const res = await invokeRoute('/cancel', { reason: 'too expensive' })

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.payload, { error: 'Unable to cancel subscription' })
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 1)
  assertRollbackSequence(clientCalls)
})

test('POST /api/subscriptions/change-plan-preview treats single legacy monthly recurring item as base plan', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_legacy_monthly', billing_cycle: { interval: 'month' } }, quantity: 4 }] } } },
    { payload: { data: { id: 'sub_123', immediate_transaction: { details: { totals: { total: '2500' } } } } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.equal(paddleCalls.length, 2)
  assert.match(paddleCalls[1].url, /\/subscriptions\/sub_123\/preview$/)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_annual', quantity: 4 }])
  assert.notEqual(res.payload.code, 'UNSUPPORTED_BILLING_ITEMS')
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan canonical monthly preview still replaces base plan', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_annual' } }], current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' }, next_billed_at: '2027-07-21T00:00:00.000Z' } } },
  ])
  installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_annual', quantity: 1 }])
})

test('POST /api/subscriptions/change-plan recognizes single legacy annual recurring item as base plan for downgrade', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'annual',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_legacy_annual', billing_cycle: { interval: 'year' } }, quantity: 2 }] } } },
    { payload: { data: { id: 'sub_123', status: 'active', current_billing_period: { ends_at: '2026-07-01T00:00:00.000Z' } } } },
  ])
  installClientMock()

  const res = await invokeRoute('/change-plan', { targetPlan: 'monthly' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [{ price_id: 'pri_monthly', quantity: 2 }])
})

test('POST /api/subscriptions/change-plan-preview blocks legacy monthly base plus true recurring monthly add-on', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 },
      { price: { id: 'pri_true_addon', billing_cycle: { interval: 'month' } }, quantity: 1 },
    ] } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 409)
  assert.equal(res.payload.code, 'UNSUPPORTED_BILLING_ITEMS')
  assert.equal(paddleCalls.length, 1)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})

test('POST /api/subscriptions/change-plan-preview preserves non-recurring item with legacy monthly base', async () => {
  resetPaddleEnv()
  installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'active', items: [
      { price: { id: 'pri_legacy_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 },
      { price: { id: 'pri_setup_fee' }, quantity: 1 },
    ] } } },
    { payload: { data: { id: 'sub_123' } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(paddleCalls[1].options.body).items, [
    { price_id: 'pri_annual', quantity: 1 },
    { price_id: 'pri_setup_fee', quantity: 1 },
  ])
})

test('POST /api/subscriptions/change-plan-preview blocks past_due Paddle subscription before preview and mutation', async () => {
  resetPaddleEnv()
  const { calls, connectCalls } = installDbMock({
    id: 123,
    email: 'user@example.com',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-07-01T00:00:00.000Z',
  })
  const paddleCalls = mockPaddleSequence([
    { payload: { data: { id: 'sub_123', status: 'past_due', items: [{ price: { id: 'pri_monthly', billing_cycle: { interval: 'month' } }, quantity: 1 }] } } },
  ])

  const res = await invokeRoute('/change-plan-preview', { targetPlan: 'annual' })

  assert.equal(res.statusCode, 402)
  assert.equal(res.payload.code, 'PAYMENT_FAILED_OR_ACTION_REQUIRED')
  assert.equal(paddleCalls.length, 1)
  assert.equal(mutationCalls(calls).length, 0)
  assert.equal(connectCalls.length, 0)
})
