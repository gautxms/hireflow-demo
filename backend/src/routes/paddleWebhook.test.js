import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import express from 'express'
import process from 'node:process'
import { readFileSync } from 'node:fs'
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
process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'true'

test('durable webhook inbox rollout defaults off and requires an explicit true value', async (t) => {
  const originalValue = process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED
  const { isDurableWebhookInboxEnabled } = await import('./paddleWebhook.js')
  t.after(() => {
    process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = originalValue
  })

  delete process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED
  assert.equal(isDurableWebhookInboxEnabled(), false)

  process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'false'
  assert.equal(isDurableWebhookInboxEnabled(), false)

  process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'TRUE'
  assert.equal(isDurableWebhookInboxEnabled(), true)
})

test('completed-payment webhook defers provider adjustment work until after durable event recording', () => {
  const source = readFileSync(new URL('./paddleWebhook.js', import.meta.url), 'utf8')
  const durableEventWrite = source.indexOf('INSERT INTO paddle_webhook_events')
  const deferredRun = source.indexOf('setImmediate(() =>')

  assert.ok(durableEventWrite >= 0)
  assert.ok(deferredRun > durableEventWrite)
  assert.doesNotMatch(source, /await runRecoveryBillingAdjustments/)
})

test('inbox ownership writes fence stale attempts by environment, attempt, and processing token', () => {
  const source = readFileSync(new URL('./paddleWebhook.js', import.meta.url), 'utf8')
  const fencedUpdates = source.match(/UPDATE paddle_webhook_events[\s\S]*?processing_token = \$5`/g) || []

  assert.ok(fencedUpdates.length >= 3)
  for (const query of fencedUpdates) {
    assert.match(query, /COALESCE\(paddle_environment, \$3\) = \$3/)
    assert.match(query, /attempt_count = \$4/)
    assert.match(query, /processing_token = \$5/)
  }
})

test('scheduled reclaim enforces the sixth-attempt boundary atomically for expired processing events', async (t) => {
  const {
    PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS,
    reclaimWebhookInboxEvent,
  } = await import('./paddleWebhook.js')
  let schedulerAttempts = PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS - 1
  let attemptCount = 10
  let leaseExpired = true
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql: String(sql), params })
    if (params[6] !== 'scheduled' || !leaseExpired || schedulerAttempts >= params[7]) {
      return { rowCount: 0, rows: [] }
    }
    schedulerAttempts += 1
    attemptCount += 1
    return {
      rowCount: 1,
      rows: [{ event_id: params[0], attempt_count: attemptCount, scheduler_attempt_count: schedulerAttempts }],
    }
  })
  const input = {
    eventId: 'evt_final_scheduled_attempt',
    payloadHash: 'hash-final-scheduled-attempt',
    payload: { event_type: 'subscription.updated', data: {} },
    environment: 'sandbox',
    processingToken: 'a699835c-e2b8-4c98-b29d-89cb173941f8',
    source: 'scheduled',
  }

  const finalAttempt = await reclaimWebhookInboxEvent(input)
  assert.equal(finalAttempt.scheduler_attempt_count, PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS)
  assert.equal(finalAttempt.attempt_count, 11)
  assert.equal(schedulerAttempts, PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS)

  const seventhAttempt = await reclaimWebhookInboxEvent({ ...input, processingToken: crypto.randomUUID() })
  assert.equal(seventhAttempt, null)
  assert.equal(attemptCount, 11)
  assert.match(
    queries[0].sql,
    /status = 'processing'[\s\S]+\$7 <> 'scheduled'[\s\S]+scheduler_attempt_count, 0\) < \$8/,
  )
  assert.equal(queries[0].params[7], PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS)

  leaseExpired = false
  schedulerAttempts = PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS - 1
  assert.equal(await reclaimWebhookInboxEvent({ ...input, processingToken: crypto.randomUUID() }), null)
})

test('two scheduled reclaimers atomically compete for the final permitted attempt', async (t) => {
  const {
    PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS,
    reclaimWebhookInboxEvent,
  } = await import('./paddleWebhook.js')
  let schedulerAttempts = PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS - 1
  t.mock.method(pool, 'query', async (_sql, params) => {
    if (schedulerAttempts >= params[7]) return { rowCount: 0, rows: [] }
    schedulerAttempts += 1
    return { rowCount: 1, rows: [{ attempt_count: 6, scheduler_attempt_count: schedulerAttempts }] }
  })
  const base = {
    eventId: 'evt_final_attempt_race', payloadHash: 'hash-final-race', payload: { event_type: 'subscription.updated' },
    environment: 'production', source: 'scheduled',
  }
  const results = await Promise.all([
    reclaimWebhookInboxEvent({ ...base, processingToken: crypto.randomUUID() }),
    reclaimWebhookInboxEvent({ ...base, processingToken: crypto.randomUUID() }),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(schedulerAttempts, PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS)
})

test('live reclaim records that a rolling-deployment row has passed signature verification', async (t) => {
  const { reclaimWebhookInboxEvent } = await import('./paddleWebhook.js')
  let capturedQuery = ''
  t.mock.method(pool, 'query', async (sql) => {
    capturedQuery = String(sql)
    return {
      rowCount: 1,
      rows: [{ event_id: 'evt_live_reclaim_verification', attempt_count: 2, scheduler_attempt_count: 0 }],
    }
  })

  await reclaimWebhookInboxEvent({
    eventId: 'evt_live_reclaim_verification',
    payloadHash: 'hash-live-reclaim-verification',
    payload: { event_type: 'subscription.updated', data: {} },
    environment: 'sandbox',
    processingToken: crypto.randomUUID(),
    source: 'live',
  })

  assert.match(
    capturedQuery,
    /verified_at\s*=\s*CASE\s+WHEN \$7 = 'live' THEN COALESCE\(verified_at, NOW\(\)\) ELSE verified_at END/,
  )
})

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

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

test('inbox heartbeat retains exact ownership across repeated lease renewals and stops on completion', async (t) => {
  const { createWebhookInboxLease } = await import('./paddleWebhook.js')
  const calls = []
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    return { rowCount: 1, rows: [] }
  })
  const lease = createWebhookInboxLease({
    eventId: 'evt_heartbeat_long_processing',
    payloadHash: 'hash-heartbeat',
    environment: 'sandbox',
    attemptCount: 7,
    processingToken: '8e95ebf0-bb34-4f7e-8940-a0ae4e377166',
    heartbeatIntervalMs: 5,
  })

  for (let attempt = 0; calls.length < 2 && attempt < 50; attempt += 1) {
    await delay(5)
  }
  await lease.assertOwned()
  assert.ok(calls.length >= 2)
  assert.ok(calls.every(({ sql }) => /processing_token = \$5/.test(sql)))
  assert.ok(calls.every(({ params }) => params[0] === 'evt_heartbeat_long_processing'
    && params[2] === 'sandbox' && params[3] === 7
    && params[4] === '8e95ebf0-bb34-4f7e-8940-a0ae4e377166'))

  let completed = false
  await lease.finish(async () => { completed = true })
  const stoppedAt = calls.length
  await delay(12)
  assert.equal(completed, true)
  assert.equal(calls.length, stoppedAt)
})

test('lost inbox ownership fences renewal and follow-up completion without leaving a timer', async (t) => {
  const { createWebhookInboxLease } = await import('./paddleWebhook.js')
  let renewals = 0
  t.mock.method(pool, 'query', async () => {
    renewals += 1
    return { rowCount: 0, rows: [] }
  })
  const lease = createWebhookInboxLease({
    eventId: 'evt_heartbeat_lost',
    payloadHash: 'hash-lost',
    environment: 'production',
    attemptCount: 2,
    processingToken: 'e90af1ab-d547-4117-b5c4-d099dad38d91',
    heartbeatIntervalMs: 5,
  })

  await delay(10)
  await assert.rejects(lease.assertOwned(), /claim was lost/)
  let staleCompletionRan = false
  await assert.rejects(
    lease.finish(async () => { staleCompletionRan = true }),
    /claim was lost/,
  )
  const stoppedAt = renewals
  await delay(12)
  assert.equal(staleCompletionRan, false)
  assert.equal(renewals, stoppedAt)
})

test('inbox lease renewal database failure safely abandons ownership and stops its timer', async (t) => {
  const { createWebhookInboxLease } = await import('./paddleWebhook.js')
  let renewals = 0
  t.mock.method(pool, 'query', async () => {
    renewals += 1
    throw new Error('lease database unavailable')
  })
  const lease = createWebhookInboxLease({
    eventId: 'evt_heartbeat_database_failure',
    payloadHash: 'hash-database-failure',
    environment: 'sandbox',
    attemptCount: 3,
    processingToken: 'bcb1990f-e960-47cf-ae80-f05c6a11756f',
    heartbeatIntervalMs: 5,
  })

  await delay(10)
  await assert.rejects(lease.assertOwned(), /claim was lost/)
  await lease.stop()
  const stoppedAt = renewals
  await delay(12)
  assert.equal(renewals, stoppedAt)
})

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
        starts_at: '2026-06-24T00:00:00.000Z',
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
        starts_at: '2026-07-10T09:44:40.151545Z',
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

test('POST /api/paddle/webhook durably claims the event before billing mutations and completes it afterward', async (t) => {
  const rawBody = JSON.stringify(buildSubscriptionUpdatedPayload({
    event_id: 'evt_durable_claim_order',
  }))
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (query.includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123' }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  const claimIndex = calls.findIndex((sql) => /INSERT INTO paddle_webhook_events/.test(sql))
  const billingMutationIndex = calls.findIndex((sql) => /UPDATE users/.test(sql))
  const completionIndex = calls.findIndex(
    (sql) => /UPDATE paddle_webhook_events[\s\S]+status = 'completed'/.test(sql),
  )
  assert.ok(claimIndex >= 0)
  assert.ok(billingMutationIndex > claimIndex)
  assert.ok(completionIndex > billingMutationIndex)
})

test('disabled durable rollout passively defers new events without running billing mutations', async (t) => {
  const originalValue = process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED
  process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'false'
  t.after(() => {
    process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = originalValue
  })

  const rawBody = JSON.stringify(buildSubscriptionUpdatedPayload({
    event_id: 'evt_legacy_compatible_rollout',
  }))
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (query.includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123' }] }
    }
    return { rowCount: 1, rows: [{ event_id: 'evt_legacy_compatible_rollout' }] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 503)
  assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
  assert.equal(calls.some((sql) => /INSERT INTO paddle_webhook_events/.test(sql)), false)
  assert.equal(
    calls.some((sql) => /VALUES[\s\S]*'processing'/.test(sql)),
    false,
  )
  assert.equal(
    calls.some((sql) => /SET last_attempt_at = NOW\(\)/.test(sql)),
    false,
  )
})

test('flag-disabled compatibility and durable-enabled processing cannot both mutate a new event', async (t) => {
  const originalValue = process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED
  t.after(() => {
    process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = originalValue
  })

  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_mixed_configuration_single_processor',
  })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const calls = []
  let inbox = null
  let userMutations = 0

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) {
      return inbox ? { rowCount: 1, rows: [{ ...inbox }] } : { rowCount: 0, rows: [] }
    }
    if (/INSERT INTO paddle_webhook_events/.test(query)) {
      inbox = {
        event_id: payload.event_id,
        payload_hash: payloadHash,
        status: 'processing',
        attempt_count: 1,
      }
      return { rowCount: 1, rows: [{ event_id: payload.event_id }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'completed'/.test(query)) {
      inbox = { ...inbox, status: 'completed' }
      return { rowCount: 1, rows: [] }
    }
    if (query.includes('FROM users')) {
      return { rowCount: 1, rows: [{ id: 42, paddle_customer_id: 'ctm_test_123' }] }
    }
    if (/UPDATE users/.test(query)) userMutations += 1
    return { rowCount: 1, rows: [] }
  })

  process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'false'
  const compatibility = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(compatibility.response.status, 503)
  assert.equal(userMutations, 0)
  assert.equal(inbox, null)

  process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'true'
  const durable = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(durable.response.status, 200)
  assert.equal(userMutations, 1)
  assert.equal(inbox.status, 'completed')
})

for (const status of ['processing', 'retryable_failed']) {
  test(`disabled durable rollout never acknowledges a ${status} row as completed`, async (t) => {
    const originalValue = process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED
    process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'false'
    t.after(() => {
      process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = originalValue
    })

    const payload = buildSubscriptionUpdatedPayload({
      event_id: `evt_legacy_compatible_${status}`,
    })
    const rawBody = JSON.stringify(payload)
    const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
    const calls = []

    t.mock.method(pool, 'query', async (sql) => {
      const query = String(sql)
      calls.push(query)
      if (query.includes('FROM paddle_webhook_events')) {
        return {
          rowCount: 1,
          rows: [{
            event_id: payload.event_id,
            payload_hash: payloadHash,
            status,
            attempt_count: 1,
            last_attempt_at: new Date().toISOString(),
          }],
        }
      }
      if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'processing'/.test(query)) {
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 1, rows: [] }
    })

    const { response, payload: responsePayload } = await postWebhook({
      body: rawBody,
      signature: signBody(rawBody),
    })

    assert.equal(response.status, 503)
    assert.equal(responsePayload.retryable, true)
    assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
  })
}

test('disabled durable rollout still acknowledges completed duplicates without replaying work', async (t) => {
  const originalValue = process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED
  process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'false'
  t.after(() => {
    process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = originalValue
  })

  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_legacy_compatible_completed',
  })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) {
      return {
        rowCount: 1,
        rows: [{
          event_id: payload.event_id,
          payload_hash: payloadHash,
          status: 'completed',
          attempt_count: 1,
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 200)
  assert.equal(responsePayload.duplicate, true)
  assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
})

test('POST /api/paddle/webhook acknowledges a completed inbox event without replaying billing mutations', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_completed_inbox_duplicate',
  })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) {
      return {
        rowCount: 1,
        rows: [{
          event_id: payload.event_id,
          payload_hash: payloadHash,
          status: 'completed',
          attempt_count: 1,
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(responsePayload, { received: true, duplicate: true })
  assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
})

test('POST /api/paddle/webhook asks Paddle to retry while another delivery holds the processing lease', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_processing_inbox_duplicate',
  })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) {
      return {
        rowCount: 1,
        rows: [{
          event_id: payload.event_id,
          payload_hash: payloadHash,
          status: 'processing',
          attempt_count: 1,
          last_attempt_at: new Date().toISOString(),
        }],
      }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'processing'/.test(query)) {
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 503)
  assert.equal(response.headers.get('retry-after'), '120')
  assert.equal(responsePayload.retryable, true)
  assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
  assert.equal(
    calls.some((sql) => /last_attempt_at <= NOW\(\) - \(\$6::integer \* INTERVAL '1 second'\)/.test(sql)),
    true,
  )
})

test('POST /api/paddle/webhook safely reclaims an expired abandoned processing lease', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({ event_id: 'evt_expired_abandoned_lease' })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  let status = 'processing'
  let attemptCount = 4
  let processingToken = 'abandoned-token'
  let mutations = 0

  t.mock.method(pool, 'query', async (sql, params) => {
    const query = String(sql)
    if (query.includes('FROM paddle_webhook_events')) {
      return {
        rowCount: 1,
        rows: [{
          event_id: payload.event_id,
          payload_hash: payloadHash,
          status,
          attempt_count: attemptCount,
          last_attempt_at: '2026-01-01T00:00:00.000Z',
        }],
      }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+attempt_count = GREATEST/.test(query)) {
      attemptCount += 1
      processingToken = params[4]
      return { rowCount: 1, rows: [{ event_id: payload.event_id, attempt_count: attemptCount }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'completed'/.test(query)) {
      assert.equal(params[3], attemptCount)
      assert.equal(params[4], processingToken)
      status = 'completed'
      return { rowCount: 1, rows: [] }
    }
    if (query.includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{ id: 42, paddle_customer_id: 'ctm_test_123', paddle_environment: 'sandbox' }],
      }
    }
    if (query.includes('UPDATE users')) mutations += 1
    return { rowCount: 1, rows: [] }
  })

  const result = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(result.response.status, 200)
  assert.equal(attemptCount, 5)
  assert.equal(status, 'completed')
  assert.equal(mutations, 1)
  assert.notEqual(processingToken, 'abandoned-token')
})

test('simultaneous retryable deliveries atomically elect one worker and the loser returns retryable', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({ event_id: 'evt_retryable_concurrent_claim' })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const inbox = {
    event_id: payload.event_id,
    payload_hash: payloadHash,
    status: 'retryable_failed',
    attempt_count: 1,
    paddle_environment: 'sandbox',
    processing_token: null,
  }
  let reads = 0
  let releaseReads
  const bothRead = new Promise((resolve) => { releaseReads = resolve })
  let mutationCount = 0

  t.mock.method(pool, 'query', async (sql, params) => {
    const query = String(sql)
    if (query.includes('FROM paddle_webhook_events')) {
      const snapshot = { ...inbox }
      reads += 1
      if (reads === 2) releaseReads()
      await bothRead
      return { rowCount: 1, rows: [snapshot] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+attempt_count = GREATEST/.test(query)) {
      if (inbox.status !== 'retryable_failed') return { rowCount: 0, rows: [] }
      inbox.status = 'processing'
      inbox.attempt_count += 1
      inbox.processing_token = params[4]
      return { rowCount: 1, rows: [{ event_id: inbox.event_id, attempt_count: inbox.attempt_count }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'completed'/.test(query)) {
      if (inbox.status !== 'processing' || inbox.attempt_count !== params[3] || inbox.processing_token !== params[4]) {
        return { rowCount: 0, rows: [] }
      }
      inbox.status = 'completed'
      return { rowCount: 1, rows: [] }
    }
    if (query.includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: payload.data.id,
          subscription_status: 'active',
          paddle_environment: 'sandbox',
        }],
      }
    }
    if (query.includes('UPDATE users')) mutationCount += 1
    return { rowCount: 1, rows: [] }
  })

  const [first, second] = await Promise.all([
    postWebhook({ body: rawBody, signature: signBody(rawBody) }),
    postWebhook({ body: rawBody, signature: signBody(rawBody) }),
  ])
  const statuses = [first.response.status, second.response.status].sort()
  assert.deepEqual(statuses, [200, 503])
  assert.equal([first.payload, second.payload].some((body) => body.retryable === true), true)
  assert.equal(mutationCount, 1)
  assert.equal(inbox.status, 'completed')
  assert.equal(inbox.attempt_count, 2)
})

test('POST /api/paddle/webhook rejects an event id reused with a different signed payload', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_payload_hash_conflict',
  })
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) {
      return {
        rowCount: 1,
        rows: [{
          event_id: payload.event_id,
          payload_hash: 'different-payload-hash',
          status: 'completed',
          attempt_count: 1,
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 409)
  assert.equal(responsePayload.error, 'Webhook event payload conflict')
  assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
})

test('POST /api/paddle/webhook acknowledges a signed redelivery of a terminal event without retrying work', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_terminal_inbox_redelivery',
  })
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const calls = []

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    calls.push(query)
    if (query.includes('FROM paddle_webhook_events')) {
      return {
        rowCount: 1,
        rows: [{
          event_id: payload.event_id,
          payload_hash: payloadHash,
          paddle_environment: 'sandbox',
          status: 'terminal_failed',
          attempt_count: 7,
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({
    body: rawBody,
    signature: signBody(rawBody),
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.has('retry-after'), false)
  assert.deepEqual(responsePayload, { received: true, duplicate: true })
  assert.equal(calls.some((sql) => /SET status = 'processing'/.test(sql)), false)
  assert.equal(calls.some((sql) => /FROM users|UPDATE users|INSERT INTO subscriptions/.test(sql)), false)
})

test('POST /api/paddle/webhook reclaims retryable failures and suppresses later completed duplicates', async (t) => {
  const payload = {
    event_id: 'evt_retryable_inbox_lifecycle',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_retryable_inbox_lifecycle',
      subscription_id: 'sub_new_monthly',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
        trialEligible: false,
        checkoutMode: 'paid_returning',
      },
      billing_period: { ends_at: '2026-08-23T00:00:00.000Z' },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  let inbox = null
  let allowReplacement = false
  let userUpdateAttempts = 0
  const failedClaimAttempts = []
  const completedClaimAttempts = []

  t.mock.method(pool, 'query', async (sql, params) => {
    const query = String(sql)

    if (query.includes('FROM paddle_webhook_events')) {
      return inbox
        ? { rowCount: 1, rows: [{ ...inbox }] }
        : { rowCount: 0, rows: [] }
    }
    if (/INSERT INTO paddle_webhook_events/.test(query)) {
      inbox = {
        event_id: payload.event_id,
        payload_hash: payloadHash,
        status: 'processing',
        attempt_count: 1,
      }
      return { rowCount: 1, rows: [{ event_id: payload.event_id }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'retryable_failed'/.test(query)) {
      failedClaimAttempts.push(params?.[3])
      inbox = { ...inbox, status: 'retryable_failed' }
      return { rowCount: 1, rows: [] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'completed'/.test(query)) {
      completedClaimAttempts.push(params?.[3])
      inbox = { ...inbox, status: 'completed' }
      return { rowCount: 1, rows: [] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'processing'/.test(query)) {
      inbox = { ...inbox, status: 'processing', attempt_count: inbox.attempt_count + 1 }
      return { rowCount: 1, rows: [{ event_id: payload.event_id, attempt_count: inbox.attempt_count }] }
    }
    if (query.includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_old_annual',
          subscription_status: 'cancelled',
          cancellation_effective_at: '2026-07-23T00:00:00.000Z',
        }],
      }
    }
    if (/UPDATE users[\s\S]+subscription_status = 'active'/.test(query)) {
      userUpdateAttempts += 1
      return { rowCount: allowReplacement ? 1 : 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const first = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(first.response.status, 500)
  assert.equal(inbox.status, 'retryable_failed')
  assert.equal(inbox.attempt_count, 1)
  assert.deepEqual(failedClaimAttempts, [1])

  allowReplacement = true
  const retry = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(retry.response.status, 200)
  assert.equal(inbox.status, 'completed')
  assert.equal(inbox.attempt_count, 2)
  assert.deepEqual(completedClaimAttempts, [2])

  const duplicate = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(duplicate.response.status, 200)
  assert.equal(duplicate.payload.duplicate, true)
  assert.equal(userUpdateAttempts, 2)
})

test('POST /api/paddle/webhook keeps activation notification failures retryable until selection succeeds', async (t) => {
  const payload = {
    event_id: 'evt_activation_notification_retry',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_activation_notification_retry',
      subscription_id: 'sub_activation_notification_retry',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
      },
      billing_period: { ends_at: '2026-08-23T00:00:00.000Z' },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  let inbox = null
  let failNotificationSelection = true
  let notificationSelections = 0

  t.mock.method(pool, 'query', async (sql, params) => {
    const query = String(sql)
    if (query.includes('FROM paddle_webhook_events')) {
      return inbox ? { rowCount: 1, rows: [{ ...inbox }] } : { rowCount: 0, rows: [] }
    }
    if (/INSERT INTO paddle_webhook_events/.test(query)) {
      inbox = { event_id: payload.event_id, payload_hash: payloadHash, status: 'processing', attempt_count: 1 }
      return { rowCount: 1, rows: [{ event_id: payload.event_id }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'retryable_failed'/.test(query)) {
      inbox = { ...inbox, status: 'retryable_failed' }
      return { rowCount: 1, rows: [] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'processing'/.test(query)) {
      inbox = { ...inbox, status: 'processing', attempt_count: inbox.attempt_count + 1 }
      return { rowCount: 1, rows: [{ event_id: payload.event_id, attempt_count: inbox.attempt_count }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'completed'/.test(query)) {
      inbox = { ...inbox, status: 'completed' }
      return { rowCount: 1, rows: [] }
    }
    if (query.includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: payload.data.subscription_id,
          subscription_status: 'active',
          paddle_environment: 'sandbox',
        }],
      }
    }
    if (/UPDATE users[\s\S]+subscription_status = 'active'/.test(query)) {
      return { rowCount: 1, rows: [] }
    }
    if (query.includes('FROM integration_webhooks')) {
      if (params?.[0] === 'subscription.activated') {
        notificationSelections += 1
        if (failNotificationSelection) throw new Error('integration webhook selection unavailable')
      }
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const first = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(first.response.status, 500)
  assert.equal(inbox.status, 'retryable_failed')
  assert.equal(notificationSelections, 1)

  failNotificationSelection = false
  const retry = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(retry.response.status, 200)
  assert.equal(inbox.status, 'completed')
  assert.equal(inbox.attempt_count, 2)
  assert.equal(notificationSelections, 2)
})

test('POST /api/paddle/webhook remains retryable when an activation delivery cannot be durably logged', async (t) => {
  const payload = {
    event_id: 'evt_activation_delivery_log_retry',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_activation_delivery_log_retry',
      subscription_id: 'sub_activation_delivery_log_retry',
      customer_id: 'ctm_test_123',
      custom_data: {
        userId: 42,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
      },
      billing_period: { ends_at: '2026-08-23T00:00:00.000Z' },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)
  const payloadHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const originalFetch = globalThis.fetch
  let inbox = null
  let failDeliveryLogInsert = true
  let deliveryAttempts = 0
  let deliveryLogAttempts = 0

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    deliveryAttempts += 1
    return {
      ok: false,
      status: 503,
      text: async () => 'temporarily unavailable',
    }
  })

  t.mock.method(pool, 'query', async (sql) => {
    const query = String(sql)
    if (query.includes('FROM paddle_webhook_events')) {
      return inbox ? { rowCount: 1, rows: [{ ...inbox }] } : { rowCount: 0, rows: [] }
    }
    if (/INSERT INTO paddle_webhook_events/.test(query)) {
      inbox = { event_id: payload.event_id, payload_hash: payloadHash, status: 'processing', attempt_count: 1 }
      return { rowCount: 1, rows: [{ event_id: payload.event_id }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'retryable_failed'/.test(query)) {
      inbox = { ...inbox, status: 'retryable_failed' }
      return { rowCount: 1, rows: [] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'processing'/.test(query)) {
      inbox = { ...inbox, status: 'processing', attempt_count: inbox.attempt_count + 1 }
      return { rowCount: 1, rows: [{ event_id: payload.event_id, attempt_count: inbox.attempt_count }] }
    }
    if (/UPDATE paddle_webhook_events[\s\S]+SET status = 'completed'/.test(query)) {
      inbox = { ...inbox, status: 'completed' }
      return { rowCount: 1, rows: [] }
    }
    if (query.includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: payload.data.subscription_id,
          subscription_status: 'active',
          paddle_environment: 'sandbox',
        }],
      }
    }
    if (query.includes('FROM integration_webhooks')) {
      return {
        rowCount: 1,
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          url: 'https://example.com/subscription-activated',
          events: ['subscription.activated'],
          secret: null,
        }],
      }
    }
    if (/INSERT INTO integration_webhook_logs/.test(query)) {
      deliveryLogAttempts += 1
      if (failDeliveryLogInsert) throw new Error('integration delivery log unavailable')
      return {
        rowCount: 1,
        rows: [{
          id: 'delivery-log-1',
          status: 'failed',
          attempt: 1,
          next_retry_at: '2026-08-23T00:10:00.000Z',
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const first = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(first.response.status, 500)
  assert.equal(inbox.status, 'retryable_failed')
  assert.ok(deliveryAttempts >= 1)
  assert.ok(deliveryLogAttempts >= 1)

  const deliveryAttemptsAfterFirstRequest = deliveryAttempts
  const deliveryLogAttemptsAfterFirstRequest = deliveryLogAttempts
  failDeliveryLogInsert = false
  const retry = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  assert.equal(retry.response.status, 200)
  assert.equal(inbox.status, 'completed')
  assert.equal(inbox.attempt_count, 2)
  assert.ok(deliveryAttempts > deliveryAttemptsAfterFirstRequest)
  assert.ok(deliveryLogAttempts > deliveryLogAttemptsAfterFirstRequest)
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
  assert.equal(updateCall.params[9], '2026-06-24T00:00:00.000Z')
  assert.match(updateCall.sql, /quota_anchor_at = CASE/)
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
  assert.equal(updateCall.params[9], '2026-07-10T09:44:40.151545Z')
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
  assert.match(userUpdateCalls(calls)[0].sql, /last_paddle_event_at IS NOT NULL[\s\S]*\$11::timestamptz > last_paddle_event_at/)
})

test('POST /api/paddle/webhook accepts a newer verified renewal date that moves backward', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_renewal_moved_backward',
    occurred_at: '2026-08-01T10:00:05.000Z',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      current_billing_period: {
        starts_at: '2026-07-01T00:00:00.000Z',
        ends_at: '2026-08-01T00:00:00.000Z',
      },
      next_billed_at: '2026-08-01T00:00:00.000Z',
    },
  })
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_test_123',
          subscription_status: 'active',
          subscription_plan: 'monthly',
          current_period_end: '2026-09-01T00:00:00.000Z',
          subscription_renewal_date: '2026-09-01T00:00:00.000Z',
          next_billing_date: '2026-09-01T00:00:00.000Z',
          last_paddle_event_at: '2026-08-01T10:00:00.000Z',
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  const updateCall = userUpdateCalls(calls)[0]

  assert.equal(response.status, 200)
  assert.equal(updateCall.params[5], '2026-08-01T00:00:00.000Z')
  assert.equal(updateCall.params[6], '2026-08-01T00:00:00.000Z')
  assert.equal(updateCall.params[10], '2026-08-01T10:00:05.000Z')
  assert.match(updateCall.sql, /\$11::timestamptz >= last_paddle_event_at/)
  assert.match(updateCall.sql, /\$6::timestamp >= current_period_end[\s\S]*last_paddle_event_at IS NOT NULL[\s\S]*\$11::timestamptz IS NOT NULL[\s\S]*\$11::timestamptz > last_paddle_event_at/)
  const projectionUpsert = calls.find(({ sql }) => /INSERT INTO subscriptions/.test(sql))
  assert.ok(projectionUpsert)
  assert.match(projectionUpsert.sql, /EXCLUDED\.latest_event_payload #>> '\{occurred_at\}'[\s\S]*subscriptions\.latest_event_payload #>> '\{occurred_at\}'[\s\S]*::timestamptz[\s\S]*>/)
  assert.match(projectionUpsert.sql, /subscriptions\.latest_event_payload #>> '\{provider_observed_at\}'/)
})

test('POST /api/paddle/webhook keeps backward renewal dates fenced until a provider watermark exists', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_backward_without_watermark',
    occurred_at: '2026-08-01T10:00:05.000Z',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      current_billing_period: {
        starts_at: '2026-07-01T00:00:00.000Z',
        ends_at: '2026-08-01T00:00:00.000Z',
      },
      next_billed_at: '2026-08-01T00:00:00.000Z',
    },
  })
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_test_123',
          subscription_status: 'active',
          subscription_plan: 'monthly',
          current_period_end: '2026-09-01T00:00:00.000Z',
          last_paddle_event_at: null,
        }],
      }
    }
    if (/UPDATE users/.test(String(sql))) return { rowCount: 0, rows: [] }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })
  const updateCall = userUpdateCalls(calls)[0]

  assert.equal(response.status, 200)
  assert.match(updateCall.sql, /\$6::timestamp >= current_period_end/)
  assert.match(updateCall.sql, /last_paddle_event_at IS NOT NULL/)
  assert.match(updateCall.sql, /\$11::timestamptz > last_paddle_event_at/)
  assert.equal(calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)), false)
})

test('POST /api/paddle/webhook does not let an undated event replace a dated subscription projection', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_subscription_updated_without_period',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      current_billing_period: null,
      next_billed_at: null,
    },
  })

  const { response, calls } = await postValidWebhookWithQueryMock(t, payload)
  const projectionUpsert = calls.find(({ sql }) => String(sql).includes('INSERT INTO subscriptions'))

  assert.equal(response.status, 200)
  assert.ok(projectionUpsert)
  assert.match(projectionUpsert.sql, /IS NULL\s+AND COALESCE\(subscriptions\.latest_event_payload/)
  assert.doesNotMatch(projectionUpsert.sql, /WHERE COALESCE\(EXCLUDED[^]*\) IS NULL\s+OR/)
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
      billing_period: {
        starts_at: '2026-07-24T00:00:00.000Z',
        ends_at: '2026-08-24T00:00:00.000Z',
      },
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

test('POST /api/paddle/webhook orders a failed payment by Paddle occurred_at instead of users.updated_at', async (t) => {
  const occurredAt = '2026-07-20T10:00:02.000Z'
  const payload = {
    event_id: 'evt_payment_failed_provider_ordering',
    event_type: 'transaction.payment_failed',
    occurred_at: occurredAt,
    data: {
      id: 'txn_failed_provider_ordering',
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
  const statusUpdate = calls.find(({ sql, params }) => /UPDATE users/.test(sql) && params?.[1] === 'payment_failed')

  assert.equal(response.status, 200)
  assert.equal(statusUpdate.params[8], occurredAt)
  assert.match(statusUpdate.sql, /\$9::timestamptz >= last_paddle_event_at/)
  assert.doesNotMatch(statusUpdate.sql, /\$9::timestamptz >= updated_at/)
  assert.match(statusUpdate.sql, /last_paddle_event_at = CASE/)
})

test('POST /api/paddle/webhook keeps a newer Past Due state when an older Active subscription update arrives', async (t) => {
  const state = {
    id: 42,
    paddle_customer_id: 'ctm_test_123',
    paddle_subscription_id: 'sub_test_123',
    subscription_status: 'past_due',
    subscription_plan: 'monthly',
    current_period_end: '2026-08-01T00:00:00.000Z',
    cancellation_effective_at: '2026-08-01T00:00:00.000Z',
    last_paddle_event_at: '2026-07-20T10:00:05.000Z',
  }
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_older_active_after_failure',
    occurred_at: '2026-07-20T10:00:02.000Z',
    data: { ...buildSubscriptionUpdatedPayload().data, status: 'active' },
  })
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) return { rowCount: 1, rows: [{ ...state }] }
    if (/UPDATE users/.test(sql)) {
      assert.match(String(sql), /\$11::timestamptz >= last_paddle_event_at/)
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  assert.equal(state.subscription_status, 'past_due')
  assert.equal(state.last_paddle_event_at, '2026-07-20T10:00:05.000Z')
  assert.ok(!calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)))
})

test('POST /api/paddle/webhook resolves an older completed transaction attempt without overriding a newer failure', async (t) => {
  const payload = {
    event_id: 'evt_older_completed_after_failure',
    event_type: 'transaction.completed',
    occurred_at: '2026-07-20T10:00:02.000Z',
    data: {
      id: 'txn_older_completed_after_failure',
      subscription_id: 'sub_test_123',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox' },
      billing_period: { starts_at: '2026-07-01T00:00:00.000Z', ends_at: '2026-08-01T00:00:00.000Z' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) return { rowCount: 1, rows: [{
      id: 42, paddle_customer_id: 'ctm_test_123', paddle_subscription_id: 'sub_test_123',
      subscription_status: 'past_due', subscription_plan: 'monthly',
      last_paddle_event_at: '2026-07-20T10:00:05.000Z',
    }] }
    if (/UPDATE users/.test(sql)) {
      assert.match(String(sql), /\$9::timestamptz >= last_paddle_event_at/)
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  const attemptUpdate = calls.find(({ sql }) => /UPDATE payment_attempts/.test(sql))
  assert.ok(attemptUpdate)
  assert.equal(attemptUpdate.params[0], 'txn_older_completed_after_failure')
  assert.ok(!calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)))
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
  assert.equal(calls.some(({ sql }) => /INSERT INTO paddle_webhook_events/.test(sql)), true)
  assert.equal(
    calls.some(({ sql }) => /UPDATE paddle_webhook_events[\s\S]+status = 'retryable_failed'/.test(sql)),
    true,
  )
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
      billing_period: {
        starts_at: '2026-07-24T00:00:00.000Z',
        ends_at: '2026-08-24T00:00:00.000Z',
      },
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
  const activeUpdate = calls.find(({ sql }) => /UPDATE users[\s\S]+subscription_status = 'active'/.test(sql))
  assert.match(activeUpdate.sql, /quota_anchor_at = COALESCE/)
  assert.equal(activeUpdate.params[7], '2026-07-24T00:00:00.000Z')
})

test('POST /api/paddle/webhook lets a completed new Monthly checkout replace a terminally cancelled Annual lifecycle', async (t) => {
  const payload = {
    event_id: 'evt_returning_monthly_completed',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_returning_monthly',
      subscription_id: 'sub_new_monthly',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox', trialEligible: false, checkoutMode: 'paid_returning' },
      billing_period: {
        starts_at: '2026-07-23T00:00:00.000Z',
        ends_at: '2026-08-23T00:00:00.000Z',
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
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_old_annual',
          subscription_status: 'cancelled',
          subscription_plan: 'annual',
          cancellation_effective_at: '2026-07-23T00:00:00.000Z',
          current_period_end: '2027-07-21T00:00:00.000Z',
        }],
      }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  const activeUpdate = calls.find(({ sql }) => /UPDATE users[\s\S]+subscription_status = 'active'/.test(sql))
  assert.equal(activeUpdate.params[1], 'sub_new_monthly')
  assert.equal(activeUpdate.params[3], 'monthly')
  assert.equal(activeUpdate.params[4], '2026-08-23T00:00:00.000Z')
  assert.match(activeUpdate.sql, /\$2 IS DISTINCT FROM paddle_subscription_id/)
  assert.match(activeUpdate.sql, /\$4 IS NOT NULL/)
  assert.match(activeUpdate.sql, /\$5::timestamp IS NOT NULL/)
  assert.match(activeUpdate.sql, /LOWER\(COALESCE\(subscription_status, ''\)\) IN \('canceled', 'cancelled'\)/)
  assert.match(activeUpdate.sql, /cancellation_effective_at = CASE/)
  assert.match(activeUpdate.sql, /cancellation_reason = CASE/)
})

test('POST /api/paddle/webhook returns retryable failure if a completed returning checkout cannot replace final cancellation', async (t) => {
  const payload = {
    event_id: 'evt_returning_monthly_zero_rows',
    event_type: 'transaction.completed',
    data: {
      id: 'txn_returning_zero_rows',
      subscription_id: 'sub_new_monthly',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, plan: 'monthly', paddleEnvironment: 'sandbox', trialEligible: false, checkoutMode: 'paid_returning' },
      billing_period: { ends_at: '2026-08-23T00:00:00.000Z' },
      items: [{ price: { id: 'pri_monthly' }, quantity: 1 }],
    },
  }
  const rawBody = JSON.stringify(payload)

  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_old_annual',
          subscription_status: 'cancelled',
          cancellation_effective_at: '2026-07-23T00:00:00.000Z',
        }],
      }
    }
    if (/UPDATE users[\s\S]+subscription_status = 'active'/.test(String(sql))) {
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response, payload: responsePayload } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 500)
  assert.equal(responsePayload.error, 'Webhook processing failed')
})

test('POST /api/paddle/webhook prevents an old cancellation event from cancelling a newer active subscription', async (t) => {
  const payload = {
    event_id: 'evt_old_annual_cancelled_late',
    event_type: 'subscription.canceled',
    data: {
      id: 'sub_old_annual',
      status: 'canceled',
      customer_id: 'ctm_test_123',
      custom_data: { userId: 42, paddleEnvironment: 'sandbox' },
      canceled_at: '2026-07-23T00:00:00.000Z',
      current_billing_period: { ends_at: '2027-07-21T00:00:00.000Z' },
    },
  }
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_new_monthly',
          subscription_status: 'active',
        }],
      }
    }
    if (/UPDATE users[\s\S]+subscription_status = 'cancelled'/.test(String(sql))) {
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  const cancellationUpdate = calls.find(({ sql }) => /UPDATE users[\s\S]+subscription_status = 'cancelled'/.test(sql))
  assert.equal(cancellationUpdate.params[1], 'sub_old_annual')
  assert.match(cancellationUpdate.sql, /paddle_subscription_id = \$2/)
})

test('POST /api/paddle/webhook prevents a delayed active update from reviving the same finally cancelled lifecycle', async (t) => {
  const payload = buildSubscriptionUpdatedPayload({
    event_id: 'evt_old_active_update_after_final_cancel',
    data: {
      ...buildSubscriptionUpdatedPayload().data,
      id: 'sub_old_annual',
      custom_data: { userId: 42, plan: 'annual', paddleEnvironment: 'sandbox' },
      items: [{ price: { id: 'pri_annual' }, quantity: 1 }],
      current_billing_period: {
        starts_at: '2026-07-21T00:00:00.000Z',
        ends_at: '2027-07-21T00:00:00.000Z',
      },
      next_billed_at: '2027-07-21T00:00:00.000Z',
    },
  })
  const rawBody = JSON.stringify(payload)
  const calls = []

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (String(sql).includes('FROM paddle_webhook_events')) return { rowCount: 0, rows: [] }
    if (String(sql).includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [{
          id: 42,
          paddle_customer_id: 'ctm_test_123',
          paddle_subscription_id: 'sub_old_annual',
          subscription_status: 'cancelled',
          subscription_plan: 'annual',
          cancellation_effective_at: '2026-07-23T00:00:00.000Z',
        }],
      }
    }
    if (/UPDATE users/.test(String(sql))) return { rowCount: 0, rows: [] }
    return { rowCount: 1, rows: [] }
  })

  const { response } = await postWebhook({ body: rawBody, signature: signBody(rawBody) })

  assert.equal(response.status, 200)
  const update = userUpdateCalls(calls)[0]
  assert.match(update.sql, /AND NOT \(\s+LOWER\(COALESCE\(subscription_status, ''\)\) IN \('canceled', 'cancelled'\)/)
  assert.equal(update.params[1], 'sub_old_annual')
})
