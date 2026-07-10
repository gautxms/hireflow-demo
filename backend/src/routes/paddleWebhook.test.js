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

async function postWebhook({ body, signature }) {
  const app = await buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (signature !== undefined) {
      headers['paddle-signature'] = signature
    }

    const response = await fetch(`http://127.0.0.1:${port}/api/paddle/webhook`, {
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
