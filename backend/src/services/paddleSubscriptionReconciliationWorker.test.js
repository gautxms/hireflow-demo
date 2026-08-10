import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  PADDLE_RECONCILIATION_ADVISORY_LOCK_ID,
  PADDLE_RECONCILIATION_BATCH_SIZE,
  PADDLE_RECONCILIATION_FAILURE_COOLDOWN_MINUTES,
  PADDLE_RECONCILIATION_INTERVAL_MS,
  PADDLE_RECONCILIATION_SUCCESS_COOLDOWN_MINUTES,
  fetchPaddleSubscriptionForReconciliation,
  runAutomaticPaddleSubscriptionReconciliation,
  startAutomaticPaddleSubscriptionReconciliation,
} from './paddleSubscriptionReconciliationWorker.js'

function candidate(id, environment = 'sandbox') {
  return {
    id,
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_customer_id: `ctm_${id}`,
    paddle_subscription_id: `sub_${id}`,
    paddle_environment: environment,
    current_period_end: '2026-09-01T00:00:00.000Z',
    subscription_renewal_date: '2026-09-01T00:00:00.000Z',
    next_billing_date: '2026-09-01T00:00:00.000Z',
    cancellation_effective_at: null,
    last_paddle_event_at: '2026-08-01T00:00:00.000Z',
  }
}

function workerDb(candidates, { lockAcquired = true } = {}) {
  const calls = []
  const attemptAt = '2026-08-10T10:00:00.000Z'
  const client = {
    async query(sql, params = []) {
      const text = String(sql)
      calls.push({ sql: text, params })
      if (/pg_try_advisory_lock/.test(text)) {
        return { rowCount: 1, rows: [{ acquired: lockAcquired }] }
      }
      if (/^SELECT id, subscription_status/.test(text.trim())) {
        const selected = candidates.slice(0, params[4])
        return { rowCount: selected.length, rows: selected }
      }
      if (/SET last_paddle_reconciliation_attempt_at/.test(text)) {
        return { rowCount: 1, rows: [{ last_paddle_reconciliation_attempt_at: attemptAt }] }
      }
      return { rowCount: 1, rows: [] }
    },
    release() {},
  }
  return {
    calls,
    db: { async connect() { return client } },
  }
}

test('automatic reconciliation is bounded, sequential, environment-scoped, and failure-isolated', async () => {
  const candidates = [candidate(1), candidate(2), candidate(3, 'production')]
  const mock = workerDb(candidates)
  const active = { count: 0, maximum: 0 }
  const loaded = []
  const reconciled = []

  const summary = await runAutomaticPaddleSubscriptionReconciliation({
    db: mock.db,
    environments: ['production', 'sandbox'],
    batchSize: 3,
    resolveConfig(environment) {
      return { environment, apiKey: `key_${environment}` }
    },
    async loadSubscription({ user, paddle }) {
      active.count += 1
      active.maximum = Math.max(active.maximum, active.count)
      loaded.push({ id: user.id, environment: paddle.environment })
      active.count -= 1
      if (user.id === 2) throw Object.assign(new Error('temporary outage'), { code: 'ETIMEDOUT' })
      return { id: user.paddle_subscription_id, customer_id: user.paddle_customer_id, status: 'active' }
    },
    async reconcile(args) {
      reconciled.push(args)
      return { reason: args.user.id === 3 ? 'already_current' : 'updated' }
    },
  })

  const attemptQuery = mock.calls.find(({ sql }) => /SET last_paddle_reconciliation_attempt_at/.test(sql))
  assert.match(attemptQuery.sql, /date_trunc\('milliseconds', clock_timestamp\(\)\)/)

  assert.equal(active.maximum, 1)
  assert.deepEqual(loaded, [
    { id: 1, environment: 'sandbox' },
    { id: 2, environment: 'sandbox' },
    { id: 3, environment: 'production' },
  ])
  assert.equal(reconciled.length, 2)
  assert.ok(reconciled.every((entry) => entry.allowProviderConfirmedRecovery === true))
  assert.ok(reconciled.every((entry) => entry.source === 'automatic_scheduler'))
  assert.deepEqual(summary, {
    selected: 3,
    attempted: 3,
    updated: 1,
    already_current: 1,
    failed: 1,
    skipped: 0,
    overlap_skipped: false,
  })

  const selection = mock.calls.find(({ sql }) => /^SELECT id, subscription_status/.test(sql.trim()))
  assert.ok(selection)
  assert.match(selection.sql, /deleted_at IS NULL/)
  assert.match(selection.sql, /paddle_subscription_id/)
  assert.match(selection.sql, /paddle_customer_id/)
  assert.match(selection.sql, /paddle_environment/)
  assert.match(selection.sql, /LIMIT \$5/)
  assert.deepEqual(selection.params.slice(0, 1), [['production', 'sandbox']])
  assert.equal(selection.params[2], PADDLE_RECONCILIATION_FAILURE_COOLDOWN_MINUTES)
  assert.equal(selection.params[3], PADDLE_RECONCILIATION_SUCCESS_COOLDOWN_MINUTES)
  assert.equal(selection.params[4], 3)
  assert.equal(mock.calls.filter(({ sql }) => /SET last_paddle_reconciled_at/.test(sql)).length, 2)
})

test('one run cannot exceed the fixed MVP batch bound', async () => {
  const mock = workerDb(Array.from({ length: 25 }, (_, index) => candidate(index + 1)))
  let providerCalls = 0
  const summary = await runAutomaticPaddleSubscriptionReconciliation({
    db: mock.db,
    environments: ['sandbox'],
    async loadSubscription({ user }) {
      providerCalls += 1
      return { id: user.paddle_subscription_id, customer_id: user.paddle_customer_id, status: 'active' }
    },
    resolveConfig: () => ({ environment: 'sandbox', apiKey: 'key' }),
    reconcile: async () => ({ reason: 'already_current' }),
  })

  assert.equal(summary.selected, PADDLE_RECONCILIATION_BATCH_SIZE)
  assert.equal(summary.attempted, PADDLE_RECONCILIATION_BATCH_SIZE)
  assert.equal(providerCalls, PADDLE_RECONCILIATION_BATCH_SIZE)
})

test('automatic reconciliation skips a concurrent scheduler before candidate selection', async () => {
  const mock = workerDb([candidate(1)], { lockAcquired: false })
  const summary = await runAutomaticPaddleSubscriptionReconciliation({
    db: mock.db,
    environments: ['sandbox'],
    loadSubscription: async () => assert.fail('provider must not be called'),
  })

  assert.equal(summary.overlap_skipped, true)
  assert.equal(summary.selected, 0)
  assert.equal(mock.calls.some(({ sql }) => /^SELECT id, subscription_status/.test(sql.trim())), false)
  assert.deepEqual(mock.calls[0].params, [PADDLE_RECONCILIATION_ADVISORY_LOCK_ID])
})

test('provider not-found and transient failures do not fabricate subscription state', async () => {
  const user = candidate(7)
  const paddle = {
    apiBaseUrl: 'https://sandbox-api.paddle.com',
    apiKey: 'secret',
    apiVersion: '1',
  }

  await assert.rejects(
    fetchPaddleSubscriptionForReconciliation({
      user,
      paddle,
      fetchImpl: async () => ({ status: 404, ok: false, async json() { return {} } }),
    }),
    (error) => error.code === 'PADDLE_SUBSCRIPTION_NOT_FOUND',
  )

  await assert.rejects(
    fetchPaddleSubscriptionForReconciliation({
      user,
      paddle,
      fetchImpl: async () => ({ status: 503, ok: false, async json() { return {} } }),
    }),
    (error) => error.code === 'PADDLE_RECONCILIATION_HTTP_503',
  )
})

test('provider request uses the linked subscription and correct environment credentials', async () => {
  const user = candidate(9, 'sandbox')
  const requests = []
  const result = await fetchPaddleSubscriptionForReconciliation({
    user,
    paddle: {
      apiBaseUrl: 'https://sandbox-api.paddle.com',
      apiKey: 'sandbox-secret',
      apiVersion: '1',
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return {
        status: 200,
        ok: true,
        async json() {
          return { data: { id: 'sub_9', customer_id: 'ctm_9', status: 'active' } }
        },
      }
    },
  })

  assert.equal(result.id, 'sub_9')
  assert.equal(requests[0].url, 'https://sandbox-api.paddle.com/subscriptions/sub_9')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer sandbox-secret')
})

test('scheduler probes the cadence schema, runs immediately, and installs a conservative interval', async () => {
  let scheduledInterval = null
  let runCount = 0
  let resolveRun
  const firstRun = new Promise((resolve) => { resolveRun = resolve })
  const timer = { unref() {} }
  const db = {
    async query(sql) {
      assert.match(String(sql), /last_paddle_reconciliation_attempt_at/)
      return { rowCount: 0, rows: [] }
    },
  }

  const returned = await startAutomaticPaddleSubscriptionReconciliation({}, {
    db,
    environments: ['sandbox'],
    setInterval(callback, interval) {
      assert.equal(typeof callback, 'function')
      scheduledInterval = interval
      return timer
    },
    async runWorker() {
      runCount += 1
      resolveRun()
      return {}
    },
  })
  await firstRun

  assert.equal(returned, timer)
  assert.equal(runCount, 1)
  assert.equal(scheduledInterval, PADDLE_RECONCILIATION_INTERVAL_MS)
  assert.equal(PADDLE_RECONCILIATION_BATCH_SIZE, 20)
})

test('scheduler remains disabled when no Paddle environment is configured', async () => {
  const db = { async query() { assert.fail('schema must not be probed') } }
  const result = await startAutomaticPaddleSubscriptionReconciliation({}, { db, environments: [] })
  assert.equal(result, null)
})

test('production startup schedules automatic reconciliation after migrations', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  const migrations = source.indexOf('await runMigrations()')
  const reconciliation = source.indexOf('await startAutomaticPaddleSubscriptionReconciliation')
  const listen = source.indexOf('app.listen')

  assert.ok(migrations >= 0)
  assert.ok(reconciliation > migrations)
  assert.ok(listen > reconciliation)
})
