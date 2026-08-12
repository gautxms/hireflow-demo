import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PADDLE_WEBHOOK_RETRY_BATCH_SIZE,
  isPaddleWebhookRetryWorkerEnabled,
  runPaddleWebhookRetryWorker,
  startPaddleWebhookRetryWorker,
} from './paddleWebhookRetryWorker.js'
import {
  PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS,
  getPaddleWebhookRetryDelayMs,
} from '../routes/paddleWebhook.js'

const enabled = {
  PADDLE_WEBHOOK_RETRY_WORKER_ENABLED: 'true',
  PADDLE_WEBHOOK_RETRY_BATCH_SIZE: String(DEFAULT_PADDLE_WEBHOOK_RETRY_BATCH_SIZE),
}

test('retry worker requires its independent feature flag', () => {
  assert.equal(isPaddleWebhookRetryWorkerEnabled({}), false)
  assert.equal(isPaddleWebhookRetryWorkerEnabled(enabled), true)
})

test('webhook retry backoff is deterministic and capped', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 20].map(getPaddleWebhookRetryDelayMs),
    [60_000, 300_000, 900_000, 3_600_000, 3_600_000, 3_600_000],
  )
  assert.equal(PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS, 6)
})

test('due candidates are processed sequentially and one poison event does not stop the batch', async () => {
  const candidates = [
    { event_id: 'evt_due', event_type: 'subscription.updated', paddle_environment: 'sandbox' },
    { event_id: 'evt_poison', event_type: 'unknown', paddle_environment: 'sandbox' },
    { event_id: 'evt_other', event_type: 'transaction.completed', paddle_environment: 'production' },
  ]
  let queryNumber = 0
  const db = {
    async query() {
      queryNumber += 1
      if (queryNumber === 1) return { rowCount: 0, rows: [] }
      if (queryNumber === 2) return { rowCount: candidates.length, rows: candidates }
      return { rowCount: 1, rows: [{ status: 'retryable_failed' }] }
    },
  }
  const active = { count: 0, max: 0 }
  const summary = await runPaddleWebhookRetryWorker({
    db,
    env: enabled,
    processEvent: async (event) => {
      active.count += 1
      active.max = Math.max(active.max, active.count)
      active.count -= 1
      if (event.event_id === 'evt_poison') throw Object.assign(new Error('bad stored payload'), { code: 'INVALID_STORED_PAYLOAD' })
      return { outcome: 'completed' }
    },
  })
  assert.equal(active.max, 1)
  assert.deepEqual(summary, {
    scanned: 3, claimed: 2, completed: 2, retryable_failed: 0,
    terminal_failed: 0, skipped: 1, ownership_lost: 0,
  })
})

test('candidate lookup encodes due time, expired lease, environment, terminal and bounded batch rules', async () => {
  const calls = []
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rowCount: 0, rows: [] } } }
  await runPaddleWebhookRetryWorker({ db, env: enabled, processEvent: async () => ({ outcome: 'completed' }) })
  assert.match(calls[0].sql, /status = 'retryable_failed'/)
  assert.match(
    calls[0].sql,
    /status = 'processing'[\s\S]+last_attempt_at <= NOW\(\) - INTERVAL '120 seconds'/,
  )
  assert.match(calls[0].sql, /COALESCE\(scheduler_attempt_count, 0\) >= \$1/)
  assert.match(calls[1].sql, /next_retry_at IS NULL OR next_retry_at <= NOW\(\)/)
  assert.match(calls[1].sql, /last_attempt_at <= NOW\(\) - INTERVAL '120 seconds'/)
  assert.match(
    calls[1].sql,
    /status = 'processing'[\s\S]+COALESCE\(scheduler_attempt_count, 0\) < \$1/,
  )
  assert.match(calls[1].sql, /paddle_environment IN \('production', 'sandbox'\)/)
  assert.match(calls[1].sql, /LIMIT \$2/)
  assert.deepEqual(calls[1].params, [6, DEFAULT_PADDLE_WEBHOOK_RETRY_BATCH_SIZE])
})

test('disabled worker performs no database reads', async () => {
  const db = { async query() { assert.fail('database should not be queried') } }
  const summary = await runPaddleWebhookRetryWorker({ db, env: {} })
  assert.equal(summary.scanned, 0)
})

test('worker startup proves durable-inbox access before scheduling', async () => {
  let queryCount = 0
  let scheduled = false
  const states = []
  const timer = { unref() {} }
  const returnedTimer = await startPaddleWebhookRetryWorker(enabled, {
    db: {
      async query() {
        queryCount += 1
        return { rowCount: 0, rows: [] }
      },
    },
    setInterval() {
      scheduled = true
      return timer
    },
    onStateChange(state) {
      states.push(state)
    },
  })

  assert.equal(queryCount, 1)
  assert.equal(scheduled, true)
  assert.equal(returnedTimer, timer)
  assert.deepEqual(states, [{ ready: true, status: 'running', errorCode: null }])
})

test('worker initialization failure is surfaced and no timer is scheduled', async () => {
  let scheduled = false
  const states = []
  await assert.rejects(
    startPaddleWebhookRetryWorker(enabled, {
      db: {
        async query() {
          throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' })
        },
      },
      setInterval() {
        scheduled = true
        return { unref() {} }
      },
      onStateChange(state) {
        states.push(state)
      },
    }),
    /database unavailable/,
  )
  assert.equal(scheduled, false)
  assert.deepEqual(states, [{ ready: false, status: 'failed', errorCode: 'ECONNREFUSED' }])
})

test('an expired capped processing attempt is terminalized without starting processing', async (t) => {
  const calls = []
  const errors = []
  let processingCalls = 0
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      if (calls.length === 1) {
        return {
          rowCount: 1,
          rows: [{
            event_id: 'evt_exhausted',
            event_type: 'subscription.updated',
            paddle_environment: 'sandbox',
            attempt_count: 6,
            scheduler_attempt_count: 6,
            last_error_code: 'SCHEDULER_ATTEMPTS_EXHAUSTED',
          }],
        }
      }
      return { rowCount: 0, rows: [] }
    },
  }
  t.mock.method(console, 'error', (...args) => errors.push(args))
  const summary = await runPaddleWebhookRetryWorker({
    db,
    env: enabled,
    processEvent: async () => {
      processingCalls += 1
      return { outcome: 'completed' }
    },
  })
  assert.equal(processingCalls, 0)
  assert.equal(summary.terminal_failed, 1)
  assert.equal(summary.scanned, 0)
  assert.match(calls[0].sql, /SET status = 'terminal_failed'/)
  assert.match(calls[0].sql, /paddle_environment IN \('production', 'sandbox'\)/)
  assert.match(calls[0].sql, /COALESCE\(scheduler_attempt_count, 0\) >= \$1/)
  assert.match(
    calls[0].sql,
    /status = 'processing'[\s\S]+last_attempt_at <= NOW\(\) - INTERVAL '120 seconds'/,
  )
  assert.match(calls[0].sql, /RETURNING event_id, event_type, paddle_environment/)
  assert.deepEqual(errors, [[
    '[Paddle webhook retry] event reached terminal failure',
    {
      eventId: 'evt_exhausted',
      eventType: 'subscription.updated',
      environment: 'sandbox',
      attemptNumber: 6,
      schedulerAttemptNumber: 6,
      result: 'terminal_failed',
      errorCode: 'SCHEDULER_ATTEMPTS_EXHAUSTED',
    },
  ]])
})
