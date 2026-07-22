import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import express from 'express'
import process from 'node:process'
import { pool } from '../db/client.js'

const WEBHOOK_SECRET = 'test-webhook-secret'
process.env.PADDLE_ENVIRONMENT = 'sandbox'
process.env.PADDLE_SANDBOX_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.PADDLE_SANDBOX_MONTHLY_PRICE_ID = 'pri_monthly'
process.env.PADDLE_SANDBOX_ANNUAL_PRICE_ID = 'pri_annual'
process.env.PADDLE_ENABLE_TEST_UPGRADE = 'true'
process.env.PADDLE_TEST_UPGRADE_KEY = 'upgrade-secret'
process.env.PADDLE_TEST_ANNUAL_PRICE_ID = 'pri_test_annual'
process.env.PADDLE_TEST_MONTHLY_PRICE_ID = 'pri_test_monthly'
process.env.PADDLE_SANDBOX_MONTHLY_LEGACY_PRICE_IDS = 'pri_legacy_monthly'
process.env.PADDLE_SANDBOX_ANNUAL_LEGACY_PRICE_IDS = 'pri_legacy_annual'

function signBody(rawBody, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const hmac = crypto.createHmac('sha256', secret).update(`${timestamp}:${rawBody}`, 'utf8').digest('hex')
  return `ts=${timestamp};h1=${hmac}`
}

async function buildApp() {
  const { default: paddleWebhookRouter } = await import('./paddleWebhook.js')
  const app = express()
  app.use('/api/paddle/webhook', paddleWebhookRouter)
  app.use(express.json())
  return app
}

async function postWebhook({ body, signature, path = '' }) {
  const app = await buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (signature !== undefined) {
      headers['paddle-signature'] = signature
    }

    const response = await fetch(`http://127.0.0.1:${port}/api/paddle/webhook${path}`, {
      method: 'POST',
      headers,
      body,
    })

    const payload = await response.json()
    return { response, payload }
  } finally {
    server.close()
  }
}

test('POST /api/paddle/webhook/sandbox verifies with the sandbox secret while production remains the default', async (t) => {
  const originalEnvironment = process.env.PADDLE_ENVIRONMENT
  const originalProductionSecret = process.env.PADDLE_PRODUCTION_WEBHOOK_SECRET
  const originalSandboxSecret = process.env.PADDLE_SANDBOX_WEBHOOK_SECRET
  t.after(() => {
    process.env.PADDLE_ENVIRONMENT = originalEnvironment
    if (originalProductionSecret === undefined) delete process.env.PADDLE_PRODUCTION_WEBHOOK_SECRET
    else process.env.PADDLE_PRODUCTION_WEBHOOK_SECRET = originalProductionSecret
    if (originalSandboxSecret === undefined) delete process.env.PADDLE_SANDBOX_WEBHOOK_SECRET
    else process.env.PADDLE_SANDBOX_WEBHOOK_SECRET = originalSandboxSecret
  })

  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_PRODUCTION_WEBHOOK_SECRET = 'production-webhook-secret'
  process.env.PADDLE_SANDBOX_WEBHOOK_SECRET = 'sandbox-webhook-secret'
  const payload = buildSubscriptionUpdatedPayload()
  const rawBody = JSON.stringify(payload)
  const queryMock = t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('SELECT event_id')) {
      return { rowCount: 1, rows: [{ event_id: payload.event_id }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const invalid = await postWebhook({
    path: '/sandbox',
    body: rawBody,
    signature: signBody(rawBody, 'production-webhook-secret'),
  })
  assert.equal(invalid.response.status, 401)
  assert.equal(queryMock.mock.callCount(), 0)

  const valid = await postWebhook({
    path: '/sandbox',
    body: rawBody,
    signature: signBody(rawBody, 'sandbox-webhook-secret'),
  })
  assert.equal(valid.response.status, 200)
  assert.equal(valid.payload.duplicate, true)
})

test('POST /api/paddle/webhook/sandbox does not mutate a production user', async (t) => {
  const originalEnvironment = process.env.PADDLE_ENVIRONMENT
  const originalSandboxSecret = process.env.PADDLE_SANDBOX_WEBHOOK_SECRET
  t.after(() => {
    process.env.PADDLE_ENVIRONMENT = originalEnvironment
    if (originalSandboxSecret === undefined) delete process.env.PADDLE_SANDBOX_WEBHOOK_SECRET
    else process.env.PADDLE_SANDBOX_WEBHOOK_SECRET = originalSandboxSecret
  })

  process.env.PADDLE_ENVIRONMENT = 'production'
  process.env.PADDLE_SANDBOX_WEBHOOK_SECRET = 'sandbox-webhook-secret'
  const payload = buildSubscriptionUpdatedPayload()
  delete payload.data.custom_data.paddleEnvironment
  const rawBody = JSON.stringify(payload)
  const calls = []
  t.mock.method(pool, 'query', async (sql) => {
    calls.push(String(sql))
    if (String(sql).includes('SELECT event_id')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_live_123',
          paddle_subscription_id: 'sub_live_123',
          subscription_status: 'active',
          paddle_environment: 'production',
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const result = await postWebhook({
    path: '/sandbox',
    body: rawBody,
    signature: signBody(rawBody, 'sandbox-webhook-secret'),
  })

  assert.equal(result.response.status, 200)
  assert.ok(!calls.some((sql) => sql.includes('UPDATE users')))
  assert.ok(!calls.some((sql) => sql.includes('INSERT INTO subscriptions')))
})

function buildSubscriptionUpdatedPayload(overrides = {}) {
  return {
    event_id: 'evt_subscription_updated_test',
    event_type: 'subscription.updated',
    data: {
      id: 'sub_test_123',
      status: 'active',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
      },
      current_billing_period: {
        ends_at: '2026-07-24T00:00:00.000Z',
      },
      next_billed_at: '2026-07-24T00:00:00.000Z',
    },
    ...overrides,
  }
}

function buildSubscriptionCreatedPayload(overrides = {}) {
  return {
    event_id: 'evt_subscription_created_test',
    event_type: 'subscription.created',
    data: {
      id: 'sub_01kx5pmebr2rska4ygrxz2zbeb',
      status: 'active',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
      },
      scheduled_change: null,
      current_billing_period: {
        ends_at: '2026-08-10T09:44:40.151545Z',
      },
      next_billed_at: '2026-08-10T09:44:40.151545Z',
    },
    ...overrides,
  }
}

test('POST /api/paddle/webhook rejects invalid signatures before parsing or DB writes', async (t) => {
  const rawBody = '{"event_type":"subscription.updated",'
  const queryMock = t.mock.method(pool, 'query', async () => {
    throw new Error('DB should not be touched for invalid signatures')
  })

  const { response, payload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody).replace(/h1=[a-f0-9]+/, 'h1=abcdef'),
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error, 'Invalid webhook signature')
  assert.equal(queryMock.mock.callCount(), 0)
})

test('POST /api/paddle/webhook rejects missing signatures before DB writes', async (t) => {
  const rawBody = JSON.stringify(buildSubscriptionUpdatedPayload())
  const queryMock = t.mock.method(pool, 'query', async () => {
    throw new Error('DB should not be touched when signature is missing')
  })

  const { response, payload } = await postWebhook({ body: rawBody })

  assert.equal(response.status, 401)
  assert.equal(payload.error, 'Invalid webhook signature')
  assert.equal(queryMock.mock.callCount(), 0)
})

test('POST /api/paddle/webhook processes valid signatures and audits only after verification', async (t) => {
  const rawBody = JSON.stringify(buildSubscriptionUpdatedPayload())
  const queries = []
  const queryMock = t.mock.method(pool, 'query', async (sql) => {
    queries.push(String(sql))

    if (String(sql).includes('FROM paddle_webhook_events')) {
      return { rowCount: 0, rows: [] }
    }

    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123' }] }
    }

    return { rowCount: 1, rows: [] }
  })

  const { response, payload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(payload, { received: true })
  assert.equal(queryMock.mock.callCount() > 0, true)
  assert.match(queries[0], /INSERT INTO paddle_webhook_audit/)
  assert.equal(queries.some((sql) => /INSERT INTO subscriptions/.test(sql)), true)
  assert.equal(queries.some((sql) => /UPDATE users/.test(sql)), true)
  assert.equal(queries.some((sql) => /INSERT INTO paddle_webhook_events/.test(sql)), true)
})


async function postValidWebhookWithQueryMock(t, payload) {
  const rawBody = JSON.stringify(payload)
  const calls = []
  const queryMock = t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) {
      return { rowCount: 0, rows: [] }
    }

    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123' }] }
    }

    return { rowCount: 1, rows: [] }
  })

  const result = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  return { ...result, calls, queryMock }
}

function userUpdateCalls(calls) {
  return calls.filter(({ sql }) => /UPDATE users/.test(sql))
}



test('POST /api/paddle/webhook clears stale cancellation_effective_at when subscription.updated reactivates without scheduled cancellation', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({ event_id: 'evt_subscription_updated_reactivated_clear_cancel' })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)
  const [updateCall] = userUpdateCalls(calls)

  assert.equal(response.status, 200)
  assert.match(updateCall.sql, /cancellation_effective_at = CASE/)
  assert.equal(updateCall.params[2], 'active')
  assert.equal(updateCall.params[8], null)
})

test('POST /api/paddle/webhook processes active subscription.created with null scheduled_change', async (t) => {
  const payload = buildSubscriptionCreatedPayload({
    event_id: 'evt_subscription_created_active_null_scheduled_change',
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)
  const [updateCall] = userUpdateCalls(calls)

  assert.equal(response.status, 200)
  assert.match(updateCall.sql, /WHEN \$9::timestamp IS NOT NULL THEN \$9::timestamp/)
  assert.equal(updateCall.params[1], 'sub_01kx5pmebr2rska4ygrxz2zbeb')
  assert.equal(updateCall.params[2], 'active')
  assert.equal(updateCall.params[8], null)
  assert.equal(calls.some(({ sql }) => /INSERT INTO paddle_webhook_events/.test(sql)), true)
})

test('POST /api/paddle/webhook preserves scheduled cancellation effective date from subscription.updated scheduled_change', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_scheduled_cancel_effective_at',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      scheduled_change: { action: 'cancel', effective_at: '2027-01-07T00:00:00.000Z' },
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)
  const [updateCall] = userUpdateCalls(calls)

  assert.equal(response.status, 200)
  assert.equal(updateCall.params[8], '2027-01-07T00:00:00.000Z')
})

test('POST /api/paddle/webhook clears renewal metadata when cancellation becomes final', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_canceled_final',
    event_type: 'subscription.canceled',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      status: 'canceled',
      canceled_at: '2026-07-24T00:00:00.000Z',
      next_billed_at: null,
      scheduled_change: null,
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)
  const [updateCall] = userUpdateCalls(calls)

  assert.equal(response.status, 200)
  assert.match(updateCall.sql, /subscription_renewal_date = NULL/)
  assert.match(updateCall.sql, /next_billing_date = NULL/)
  assert.match(updateCall.sql, /cancellation_effective_at = COALESCE\(\$5, cancellation_effective_at, \$4, NOW\(\)\)/)
  assert.equal(updateCall.params[4], '2026-07-24T00:00:00.000Z')
})

test('POST /api/paddle/webhook derives monthly from subscription.updated canonical monthly item', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_monthly_item',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1, totals: { total: '9900' } }],
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[4], 'monthly')
})

test('POST /api/paddle/webhook derives annual from subscription.updated active item', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_annual_item',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_annual' }, quantity: 1, totals: { total: '99900' } }],
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[4], 'annual')
  assert.match(userUpdateCalls(calls)[0].sql, /subscription_renewal_date = COALESCE\(\$6, subscription_renewal_date\)/)
  assert.match(userUpdateCalls(calls)[0].sql, /\$6::timestamp >= current_period_end/)
})



test('POST /api/paddle/webhook derives monthly from subscription.updated test monthly item', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_test_monthly_item',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_test_monthly' }, quantity: 1, totals: { total: '100' } }],
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[4], 'monthly')
})

test('POST /api/paddle/webhook derives annual from subscription.updated test annual item', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_test_annual_item',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_test_annual' }, quantity: 1, totals: { total: '1200' } }],
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[4], 'annual')
})

test('POST /api/paddle/webhook derives annual from transaction.completed test annual item', async (t) => {
  const payload = {
    event_id: 'evt_transaction_completed_test_annual_item',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_test_annual_123',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      billing_period: { ends_at: '2027-07-24T00:00:00.000Z' },
      items: [
        { price: { id: 'pri_monthly' }, quantity: -1, totals: { total: '-4900' }, description: 'Credit for removed monthly plan' },
        { price: { id: 'pri_test_annual' }, quantity: 1, totals: { total: '1200' }, description: 'Test annual plan' },
      ],
    },
  }

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[3], 'annual')
})


test('POST /api/paddle/webhook derives monthly from transaction.completed test monthly item', async (t) => {
  const payload = {
    event_id: 'evt_transaction_completed_test_monthly_item',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_test_monthly_123',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      billing_period: { ends_at: '2026-08-24T00:00:00.000Z' },
      items: [
        { price: { id: 'pri_test_annual' }, quantity: -1, totals: { total: '-1200' }, description: 'Credit for removed test annual plan' },
        { price: { id: 'pri_test_monthly' }, quantity: 1, totals: { total: '100' }, description: 'Test monthly plan' },
      ],
    },
  }

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[3], 'monthly')
})

test('POST /api/paddle/webhook maps legacy monthly and annual item aliases', async (t) => {
  const monthlyPayload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_legacy_monthly_item',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_legacy_monthly' }, quantity: 1, totals: { total: '9900' } }],
    },
  })

  const monthlyResult = await postValidWebhookWithQueryMock(t, monthlyPayload)

  assert.equal(monthlyResult.response.status, 200)
  assert.equal(userUpdateCalls(monthlyResult.calls)[0].params[4], 'monthly')

  const annualPayload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_legacy_annual_item',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_legacy_annual' }, quantity: 1, totals: { total: '99900' } }],
    },
  })

  const annualResult = await postValidWebhookWithQueryMock(t, annualPayload)

  assert.equal(annualResult.response.status, 200)
  assert.equal(userUpdateCalls(annualResult.calls)[0].params[4], 'annual')
})

test('POST /api/paddle/webhook ignores old monthly credit and derives annual transaction item', async (t) => {
  const payload = {
    event_id: 'evt_transaction_completed_upgrade_proration',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_upgrade_123',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      billing_period: { ends_at: '2027-07-24T00:00:00.000Z' },
      items: [
        { price: { id: 'pri_monthly' }, quantity: -1, totals: { total: '-4900' }, description: 'Credit for removed monthly plan' },
        { price: { id: 'pri_annual' }, quantity: 1, totals: { total: '99900' }, description: 'Annual plan' },
      ],
    },
  }

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[3], 'annual')
})

test('POST /api/paddle/webhook does not overwrite plan from only negative old monthly credit', async (t) => {
  const payload = {
    event_id: 'evt_transaction_completed_credit_only',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_credit_only_123',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      billing_period: { ends_at: '2027-07-24T00:00:00.000Z' },
      items: [
        { price: { id: 'pri_monthly' }, quantity: -1, totals: { total: '-4900' }, description: 'Credit for removed monthly plan' },
      ],
    },
  }

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[3], null)
})

test('POST /api/paddle/webhook does not overwrite plan from unknown add-on-only items', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_addon_only',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_addon_only' }, quantity: 1, totals: { total: '1500' } }],
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[4], null)
})

test('POST /api/paddle/webhook still maps test-monthly custom data when no item source exists', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_test_monthly_custom_data',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      custom_data: { userId: 42, plan: 'test-monthly', paddleEnvironment: 'sandbox' },
      items: [],
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)

  assert.equal(response.status, 200)
  assert.equal(userUpdateCalls(calls)[0].params[4], 'monthly')
})

test('POST /api/paddle/webhook rejects invalid JSON with valid signature before business processing', async (t) => {
  const rawBody = '{"event_type":"subscription.updated",'
  const queryMock = t.mock.method(pool, 'query', async () => {
    throw new Error('Business processing should not run for invalid JSON')
  })

  const { response, payload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Invalid JSON payload')
  assert.equal(queryMock.mock.callCount(), 0)
})


test('POST /api/paddle/webhook returns 200 and logs when failed-payment attempt tracking fails', async (t) => {
  const payload = {
    event_id: 'evt_payment_failed_tracking_error',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_tracking_error',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      currency_code: 'USD',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []
  const errors = []

  t.mock.method(console, 'error', (...args) => {
    errors.push(args)
  })

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) {
      return { rowCount: 0, rows: [] }
    }

    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123', subscription_status: 'inactive' }] }
    }

    if (String(sql).includes('INSERT INTO payment_attempts')) {
      const error = new Error('column "customer_email" of relation "payment_attempts" does not exist')
      error.code = '42703'
      throw error
    }

    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(responsePayload, { received: true })
  assert.equal(calls.some(({ sql }) => /UPDATE users/.test(sql)), true)
  assert.equal(calls.some(({ sql }) => /INSERT INTO paddle_webhook_events/.test(sql)), true)
  assert.equal(calls.some(({ sql, params }) => /log_errors|error_logs|INSERT INTO/.test(sql) && params?.includes?.('payment.failure.record_failed')), true)
  assert.equal(errors.some(([message]) => String(message).includes('payment.failure.record_failed')), true)
})

test('POST /api/paddle/webhook skips stale unrelated failed-payment status for active subscription', async (t) => {
  const payload = {
    event_id: 'evt_payment_failed_stale_unrelated',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_stale_unrelated',
      subscription_id: 'sub_old_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) {
      return { rowCount: 0, rows: [] }
    }

    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123', paddle_subscription_id: 'sub_current_123', subscription_status: 'active' }] }
    }

    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), false)
  assert.equal(calls.some(({ sql }) => /INSERT INTO payment_attempts/.test(sql)), true)
})

test('POST /api/paddle/webhook lets inactive users become payment_failed for failed checkout', async (t) => {
  const payload = {
    event_id: 'evt_payment_failed_inactive_checkout',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_inactive_checkout',
      subscription_id: null,
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123', subscription_status: 'inactive' }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), true)
  assert.equal(calls.some(({ sql }) => /INSERT INTO payment_attempts/.test(sql)), true)
})

test('POST /api/paddle/webhook skips subscriptionless failed checkout for active user', async (t) => {
  const payload = {
    event_id: 'evt_payment_failed_active_subscriptionless',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_active_subscriptionless',
      subscription_id: null,
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(console, 'warn', () => {})
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123', paddle_subscription_id: 'sub_current_123', subscription_status: 'active' }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), false)
  assert.equal(calls.some(({ sql }) => /INSERT INTO payment_attempts/.test(sql)), true)
})

test('POST /api/paddle/webhook allows failed payment for active user current subscription', async (t) => {
  const payload = {
    event_id: 'evt_payment_failed_active_current_subscription',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_active_current_subscription',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123', paddle_subscription_id: 'sub_current_123', subscription_status: 'active' }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), true)
})

test('POST /api/paddle/webhook preserves Monthly access and restores Paddle after a failed Annual upgrade', async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  const paddleCalls = []
  const payload = {
    event_id: 'evt_failed_annual_upgrade_preserves_monthly',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_upgrade',
      status: 'past_due',
      origin: 'subscription_update',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'annual',
        paddleEnvironment: 'sandbox',
        hireflowPlanChange: {
          fromPlan: 'monthly',
          toPlan: 'annual',
          priorStatus: 'active',
          priorCurrentPeriodEnd: '2026-08-20T00:00:00.000Z',
          priorNextBillingDate: '2026-08-20T00:00:00.000Z',
          priorRenewalDate: '2026-08-20T00:00:00.000Z',
          previousItems: [{ price_id: 'pri_monthly', quantity: 1 }],
          startedAt: '2026-07-20T00:00:00.000Z',
          outcome: 'pending',
        },
      },
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)
  let recoveredCustomData = null

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_current_123',
          subscription_status: 'active',
          subscription_plan: 'monthly',
          current_period_end: '2026-08-20T00:00:00.000Z',
          next_billing_date: '2026-08-20T00:00:00.000Z',
          subscription_renewal_date: '2026-08-20T00:00:00.000Z',
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    paddleCalls.push({ url: String(url), options })
    const isRestore = options.method === 'PATCH' && String(url).endsWith('/subscriptions/sub_current_123')
    if (isRestore) recoveredCustomData = JSON.parse(options.body).custom_data
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: {
        id: String(url).includes('/transactions/') ? 'txn_failed_upgrade' : 'sub_current_123',
        status: isRestore || paddleCalls.length >= 4 ? 'active' : 'past_due',
        custom_data: recoveredCustomData || payload.data.custom_data,
        items: [{ price: { id: isRestore || paddleCalls.length >= 4 ? 'pri_monthly' : 'pri_annual' }, quantity: 1 }],
      } }),
    }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), false)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'monthly' && params?.[2] === 'active'), true)
  assert.equal(calls.some(({ sql, params }) => /INSERT INTO subscriptions/.test(sql) && params?.[2] !== 'active'), false)

  const cancelCall = paddleCalls.find(({ url }) => url.endsWith('/transactions/txn_failed_upgrade'))
  assert.deepEqual(JSON.parse(cancelCall.options.body), { status: 'canceled' })
  const restoreCall = paddleCalls.find(({ url, options }) => url.endsWith('/subscriptions/sub_current_123') && options.method === 'PATCH')
  const restoreBody = JSON.parse(restoreCall.options.body)
  assert.equal(restoreBody.proration_billing_mode, 'do_not_bill')
  assert.deepEqual(restoreBody.items, [{ price_id: 'pri_monthly', quantity: 1 }])
})

test('POST /api/paddle/webhook retries an identified upgrade when cancellation remains incomplete', async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  let cancellationCanSucceed = false
  const payload = {
    event_id: 'evt_failed_upgrade_retryable_cancellation',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_upgrade_retryable',
      status: 'past_due',
      origin: 'subscription_update',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'annual',
        paddleEnvironment: 'sandbox',
        hireflowPlanChange: {
          fromPlan: 'monthly',
          toPlan: 'annual',
          priorStatus: 'active',
          previousItems: [{ price_id: 'pri_monthly', quantity: 1 }],
          startedAt: '2026-07-20T00:00:00.000Z',
          outcome: 'pending',
        },
      },
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)
  let recoveredCustomData = null

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_current_123',
        subscription_status: 'active',
        subscription_plan: 'monthly',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    if (String(url).endsWith('/transactions/txn_failed_upgrade_retryable') && options.method === 'PATCH') {
      if (!cancellationCanSucceed) {
        return { ok: false, status: 409, json: async () => ({ error: { code: 'transaction_not_cancelled' } }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: { id: 'txn_failed_upgrade_retryable', status: 'canceled' } }) }
    }
    if (String(url).endsWith('/transactions/txn_failed_upgrade_retryable')) {
      return { ok: true, status: 200, json: async () => ({ data: { id: 'txn_failed_upgrade_retryable', status: 'past_due' } }) }
    }
    if (String(url).endsWith('/subscriptions/sub_current_123') && options.method === 'PATCH') {
      recoveredCustomData = JSON.parse(options.body).custom_data
      return { ok: true, status: 200, json: async () => ({ data: { id: 'sub_current_123', status: 'active', custom_data: recoveredCustomData } }) }
    }
    if (String(url).endsWith('/subscriptions/sub_current_123')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: {
          id: 'sub_current_123',
          status: 'active',
          custom_data: recoveredCustomData || payload.data.custom_data,
          items: [{ price: { id: cancellationCanSucceed ? 'pri_monthly' : 'pri_annual' }, quantity: 1 }],
        } }),
      }
    }
    throw new Error(`Unexpected Paddle request: ${url}`)
  })

  const firstAttempt = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(firstAttempt.response.status, 500)
  assert.equal(calls.some(({ sql }) => /INSERT INTO paddle_webhook_events/.test(sql)), false)
  assert.equal(calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)), false)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && (params?.[1] === 'annual' || params?.[2] === 'past_due')), false)

  cancellationCanSucceed = true
  const retry = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(retry.response.status, 200)
  assert.equal(calls.some(({ sql }) => /INSERT INTO paddle_webhook_events/.test(sql)), true)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'monthly' && params?.[2] === 'active'), true)
  assert.equal(calls.some(({ sql, params }) => /INSERT INTO subscriptions/.test(sql) && params?.[2] === 'active'), true)
})

test('POST /api/paddle/webhook keeps Monthly active when a stale subscription update arrives after recovery', async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  const paddleCalls = []
  let transactionStatus = 'past_due'
  let subscriptionState = null
  const pendingCustomData = {
    userId: 42,
    plan: 'annual',
    paddleEnvironment: 'sandbox',
    hireflowPlanChange: {
      fromPlan: 'monthly',
      toPlan: 'annual',
      priorStatus: 'active',
      priorCurrentPeriodEnd: '2026-08-20T00:00:00.000Z',
      priorNextBillingDate: '2026-08-20T00:00:00.000Z',
      priorRenewalDate: '2026-08-20T00:00:00.000Z',
      previousItems: [{ price_id: 'pri_monthly', quantity: 1 }],
      startedAt: '2026-07-20T00:00:00.000Z',
      outcome: 'pending',
    },
  }
  const failedTransaction = {
    event_id: 'evt_failed_upgrade_before_delayed_update',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_before_delayed_update',
      status: 'past_due',
      origin: 'subscription_update',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: pendingCustomData,
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  }
  const delayedSubscriptionUpdate = buildSubscriptionUpdatedPayload({
    event_id: 'evt_delayed_upgrade_subscription_update',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      id: 'sub_current_123',
      status: 'past_due',
      custom_data: pendingCustomData,
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  })

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_current_123',
        subscription_status: 'active',
        subscription_plan: 'monthly',
        current_period_end: '2026-08-20T00:00:00.000Z',
        next_billing_date: '2026-08-20T00:00:00.000Z',
        subscription_renewal_date: '2026-08-20T00:00:00.000Z',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    paddleCalls.push({ url: String(url), options })

    if (String(url).includes('/transactions?')) {
      return { ok: true, status: 200, json: async () => ({ data: [{
        id: 'txn_failed_before_delayed_update',
        status: transactionStatus,
        origin: 'subscription_update',
        created_at: '2026-07-20T00:01:00.000Z',
        custom_data: pendingCustomData,
      }] }) }
    }
    if (String(url).endsWith('/transactions/txn_failed_before_delayed_update') && options.method === 'PATCH') {
      transactionStatus = 'canceled'
      return { ok: true, status: 200, json: async () => ({ data: { id: 'txn_failed_before_delayed_update', status: transactionStatus } }) }
    }
    if (String(url).endsWith('/subscriptions/sub_current_123') && options.method === 'PATCH') {
      const body = JSON.parse(options.body)
      subscriptionState = {
        id: 'sub_current_123',
        status: 'active',
        custom_data: body.custom_data,
        items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
      }
      return { ok: true, status: 200, json: async () => ({ data: subscriptionState }) }
    }
    if (String(url).endsWith('/subscriptions/sub_current_123')) {
      return { ok: true, status: 200, json: async () => ({ data: subscriptionState || {
        id: 'sub_current_123',
        status: 'past_due',
        custom_data: pendingCustomData,
        items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
      } }) }
    }
    throw new Error(`Unexpected Paddle request: ${url}`)
  })

  const failedResult = await postWebhook({
    body: JSON.stringify(failedTransaction),
    signature: signBody(JSON.stringify(failedTransaction)),
  })
  const delayedResult = await postWebhook({
    body: JSON.stringify(delayedSubscriptionUpdate),
    signature: signBody(JSON.stringify(delayedSubscriptionUpdate)),
  })

  assert.equal(failedResult.response.status, 200)
  assert.equal(delayedResult.response.status, 200)
  assert.equal(transactionStatus, 'canceled')
  assert.equal(subscriptionState.custom_data.plan, 'monthly')
  assert.equal(subscriptionState.custom_data.hireflowPlanChange.outcome, 'recovered')
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && (params?.[1] === 'annual' || params?.[2] === 'past_due')), false)
  const subscriptionWrites = calls.filter(({ sql }) => /INSERT INTO subscriptions/.test(sql))
  assert.equal(subscriptionWrites.length, 2)
  assert.equal(subscriptionWrites.every(({ params }) => params?.[2] === 'active'), true)
  assert.equal(paddleCalls.filter(({ url, options }) => url.endsWith('/transactions/txn_failed_before_delayed_update') && options.method === 'PATCH').length, 1)
})

test('POST /api/paddle/webhook keeps Monthly active when subscription update arrives before failed transaction', async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  const paddleCalls = []
  let transactionStatus = 'past_due'
  let subscriptionState = null
  const pendingCustomData = {
    userId: 42,
    plan: 'annual',
    paddleEnvironment: 'sandbox',
    hireflowPlanChange: {
      fromPlan: 'monthly',
      toPlan: 'annual',
      priorStatus: 'active',
      previousItems: [{ price_id: 'pri_monthly', quantity: 1 }],
      startedAt: '2026-07-20T00:00:00.000Z',
      outcome: 'pending',
    },
  }
  const subscriptionUpdate = buildSubscriptionUpdatedPayload({
    event_id: 'evt_upgrade_subscription_update_first',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      id: 'sub_current_123',
      status: 'past_due',
      custom_data: pendingCustomData,
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  })
  const failedTransaction = {
    event_id: 'evt_failed_upgrade_transaction_second',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_transaction_second',
      status: 'past_due',
      origin: 'subscription_update',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: pendingCustomData,
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  }

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_current_123',
        subscription_status: 'active',
        subscription_plan: 'monthly',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    paddleCalls.push({ url: String(url), options })

    if (String(url).includes('/transactions?')) {
      return { ok: true, status: 200, json: async () => ({ data: [{
        id: 'txn_failed_transaction_second',
        status: transactionStatus,
        origin: 'subscription_update',
        created_at: '2026-07-20T00:01:00.000Z',
        custom_data: pendingCustomData,
      }] }) }
    }
    if (String(url).endsWith('/transactions/txn_failed_transaction_second') && options.method === 'PATCH') {
      if (transactionStatus === 'canceled') {
        return { ok: false, status: 409, json: async () => ({ error: { code: 'transaction_already_canceled' } }) }
      }
      transactionStatus = 'canceled'
      return { ok: true, status: 200, json: async () => ({ data: { id: 'txn_failed_transaction_second', status: transactionStatus } }) }
    }
    if (String(url).endsWith('/transactions/txn_failed_transaction_second')) {
      return { ok: true, status: 200, json: async () => ({ data: { id: 'txn_failed_transaction_second', status: transactionStatus } }) }
    }
    if (String(url).endsWith('/subscriptions/sub_current_123') && options.method === 'PATCH') {
      const body = JSON.parse(options.body)
      subscriptionState = {
        id: 'sub_current_123',
        status: 'active',
        custom_data: body.custom_data,
        items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
      }
      return { ok: true, status: 200, json: async () => ({ data: subscriptionState }) }
    }
    if (String(url).endsWith('/subscriptions/sub_current_123')) {
      return { ok: true, status: 200, json: async () => ({ data: subscriptionState || {
        id: 'sub_current_123',
        status: 'past_due',
        custom_data: pendingCustomData,
        items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
      } }) }
    }
    throw new Error(`Unexpected Paddle request: ${url}`)
  })

  const updateBody = JSON.stringify(subscriptionUpdate)
  const updateResult = await postWebhook({ body: updateBody, signature: signBody(updateBody) })
  const transactionBody = JSON.stringify(failedTransaction)
  const transactionResult = await postWebhook({ body: transactionBody, signature: signBody(transactionBody) })

  assert.equal(updateResult.response.status, 200)
  assert.equal(transactionResult.response.status, 200)
  assert.equal(transactionStatus, 'canceled')
  assert.equal(subscriptionState.custom_data.plan, 'monthly')
  assert.equal(subscriptionState.custom_data.hireflowPlanChange.outcome, 'recovered')
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && (params?.[1] === 'annual' || params?.[2] === 'past_due')), false)
  const subscriptionWrites = calls.filter(({ sql }) => /INSERT INTO subscriptions/.test(sql))
  assert.equal(subscriptionWrites.length, 2)
  assert.equal(subscriptionWrites.every(({ params }) => params?.[2] === 'active'), true)
  assert.equal(paddleCalls.filter(({ url, options }) => url.endsWith('/subscriptions/sub_current_123') && options.method === 'PATCH').length, 1)
})

test('POST /api/paddle/webhook ignores a past-due Annual plan event while Monthly access is paid', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_past_due_annual_upgrade_preserves_monthly',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      status: 'past_due',
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
    },
  })
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_test_123',
        subscription_status: 'active',
        subscription_plan: 'monthly',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql }) => /UPDATE users/.test(sql)), false)
  assert.equal(calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)), false)
})

test('POST /api/paddle/webhook still makes a failed Monthly renewal past due', async (t) => {
  const payload = {
    event_id: 'evt_failed_monthly_renewal_is_past_due',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_renewal',
      status: 'past_due',
      origin: 'subscription_recurring',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_current_123',
        subscription_status: 'active',
        subscription_plan: 'monthly',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), true)
})

test('POST /api/paddle/webhook does not preserve a scheduled downgrade when its recurring renewal fails', async (t) => {
  const payload = {
    event_id: 'evt_failed_annual_renewal_after_scheduled_downgrade',
    event_type: 'transaction.payment_failed',
    data: {
      id: 'txn_failed_annual_renewal',
      status: 'past_due',
      origin: 'subscription_recurring',
      subscription_id: 'sub_current_123',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
        hireflowPlanChange: {
          fromPlan: 'annual',
          toPlan: 'monthly',
          priorStatus: 'active',
          previousItems: [{ price_id: 'pri_annual', quantity: 1 }],
          startedAt: '2026-07-20T00:00:00.000Z',
          outcome: 'pending',
        },
      },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_current_123',
        subscription_status: 'active',
        subscription_plan: 'annual',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed'), true)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'annual' && params?.[2] === 'active'), false)
})

test('POST /api/paddle/webhook does not recover a recurring renewal from its companion subscription update', async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  const paddleCalls = []
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_recurring_renewal_companion_update',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      id: 'sub_current_123',
      status: 'past_due',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
        hireflowPlanChange: {
          fromPlan: 'annual',
          toPlan: 'monthly',
          priorStatus: 'active',
          previousItems: [{ price_id: 'pri_annual', quantity: 1 }],
          startedAt: '2026-07-20T00:00:00.000Z',
          outcome: 'pending',
        },
      },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    },
  })
  const rawBody = JSON.stringify(payload)

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return { rowCount: 1, rows: [{
        id: 42,
        paddle_customer_id: 'ctm_test_123',
        paddle_subscription_id: 'sub_current_123',
        subscription_status: 'active',
        subscription_plan: 'annual',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    paddleCalls.push({ url: String(url), options })
    return { ok: true, status: 200, json: async () => ({ data: [] }) }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(paddleCalls.some(({ url }) => url.includes('/transactions?')), true)
  assert.equal(paddleCalls.some(({ url, options }) => url.includes('/subscriptions/') && options.method === 'PATCH'), false)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'annual' && params?.[2] === 'active'), false)
  assert.equal(calls.some(({ sql, params }) => /UPDATE users/.test(sql) && params?.[2] === 'past_due'), true)
})

test('POST /api/paddle/webhook transaction.completed keeps setting user active', async (t) => {
  const payload = {
    event_id: 'evt_transaction_completed_sets_active',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_completed_sets_active',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      billing_period: { ends_at: '2026-08-24T00:00:00.000Z' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })

    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123' }] }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(calls.some(({ sql }) => /UPDATE users[\s\S]+subscription_status = 'active'/.test(sql)), true)
})
