import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createResumeAnalysisQuotaStore,
  getResumeQuotaRevalidationDelay,
  QUOTA_REVALIDATION_FALLBACK_MS,
  QUOTA_TRANSITION_SAFETY_MS,
} from './resumeAnalysisQuotaStore.js'

function createHarness(responses, startAt = Date.parse('2026-08-20T00:00:00.000Z')) {
  let now = startAt
  let loadCount = 0
  let nextTimerId = 1
  const timers = new Map()
  const delays = []
  const store = createResumeAnalysisQuotaStore({
    loadQuota: async () => {
      const response = responses[Math.min(loadCount, responses.length - 1)]
      loadCount += 1
      if (response instanceof Error) throw response
      return response
    },
    now: () => now,
    setTimer: (callback, delay) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, { callback, delay })
      delays.push(delay)
      return id
    },
    clearTimer: (id) => timers.delete(id),
    isVisible: () => true,
  })
  return {
    store,
    get loadCount() { return loadCount },
    get timerCount() { return timers.size },
    get delays() { return delays },
    async flush() { await new Promise((resolve) => setImmediate(resolve)) },
    async runTimer() {
      const [id, timer] = timers.entries().next().value
      timers.delete(id)
      now += timer.delay
      timer.callback()
      await this.flush()
    },
  }
}

function blocked(nextRevalidationAt) {
  return { limit: 800, used: 800, available: 0, canCreateAnalysis: false, nextRevalidationAt }
}

function available(nextRevalidationAt) {
  return { limit: 800, used: 799, available: 1, canCreateAnalysis: true, nextRevalidationAt }
}

test('focused exhausted state refreshes after the quota period boundary and re-enables capacity', async () => {
  const boundary = '2026-08-20T00:00:10.000Z'
  const harness = createHarness([blocked(boundary), available('2026-09-20T00:00:00.000Z')])
  const unsubscribe = harness.store.subscribe(() => {})
  await harness.flush()
  assert.equal(harness.store.getSnapshot().quota.canCreateAnalysis, false)
  await harness.runTimer()
  assert.equal(harness.store.getSnapshot().quota.canCreateAnalysis, true)
  assert.equal(harness.loadCount, 2)
  unsubscribe()
})

test('focused blocked state refreshes after a temporary reservation expiry', async () => {
  const expiry = '2026-08-20T00:00:05.000Z'
  const harness = createHarness([blocked(expiry), available('2026-09-20T00:00:00.000Z')])
  const unsubscribe = harness.store.subscribe(() => {})
  await harness.flush()
  assert.equal(harness.delays[0], 5000 + QUOTA_TRANSITION_SAFETY_MS)
  await harness.runTimer()
  assert.equal(harness.store.getSnapshot().quota.available, 1)
  unsubscribe()
})

test('continued server exhaustion remains blocked after automatic revalidation', async () => {
  const harness = createHarness([
    blocked('2026-08-20T00:00:01.000Z'),
    blocked('2026-09-20T00:00:00.000Z'),
  ])
  const unsubscribe = harness.store.subscribe(() => {})
  await harness.flush()
  await harness.runTimer()
  assert.equal(harness.store.getSnapshot().quota.canCreateAnalysis, false)
  unsubscribe()
})

test('canonical changes clear and reschedule one next-transition timer', async () => {
  const harness = createHarness([
    blocked('2026-08-20T00:00:10.000Z'),
    available('2026-08-20T00:00:20.000Z'),
  ])
  const unsubscribe = harness.store.subscribe(() => {})
  await harness.flush()
  assert.equal(harness.timerCount, 1)
  await harness.store.refresh()
  assert.equal(harness.timerCount, 1)
  assert.equal(harness.delays.at(-1), 20000 + QUOTA_TRANSITION_SAFETY_MS)
  unsubscribe()
})

test('already-passed transition uses the low-frequency fallback instead of a tight loop', () => {
  const delay = getResumeQuotaRevalidationDelay({
    quota: { nextRevalidationAt: '2026-08-19T23:59:59.000Z' },
    now: Date.parse('2026-08-20T00:00:00.000Z'),
  })
  assert.equal(delay, QUOTA_REVALIDATION_FALLBACK_MS)
})

test('multiple consumers share one request and one timer, then cleanup on final unmount', async () => {
  const harness = createHarness([available('2026-09-20T00:00:00.000Z')])
  const first = harness.store.subscribe(() => {})
  const second = harness.store.subscribe(() => {})
  await harness.flush()
  assert.equal(harness.loadCount, 1)
  assert.equal(harness.timerCount, 1)
  assert.equal(harness.store.subscriberCount(), 2)
  first()
  assert.equal(harness.timerCount, 1)
  second()
  assert.equal(harness.timerCount, 0)
  assert.equal(harness.store.hasScheduledRefresh(), false)
})

test('focus or reconnect refresh calls deduplicate while a request is in flight', async () => {
  let resolveLoad
  let loadCount = 0
  const store = createResumeAnalysisQuotaStore({
    loadQuota: () => {
      loadCount += 1
      return new Promise((resolve) => { resolveLoad = resolve })
    },
  })
  const unsubscribe = store.subscribe(() => {})
  const focusRefresh = store.refresh()
  const reconnectRefresh = store.refresh()
  assert.equal(loadCount, 0)
  await Promise.resolve()
  assert.equal(loadCount, 1)
  resolveLoad(available('2026-09-20T00:00:00.000Z'))
  await Promise.all([focusRefresh, reconnectRefresh])
  assert.equal(loadCount, 1)
  unsubscribe()
})

test('API failure becomes permissive unavailable state and retries only at fallback frequency', async () => {
  const harness = createHarness([new Error('temporary failure')])
  const unsubscribe = harness.store.subscribe(() => {})
  await harness.flush()
  assert.equal(harness.store.getSnapshot().status, 'unavailable')
  assert.equal(harness.timerCount, 1)
  assert.equal(harness.delays[0], QUOTA_REVALIDATION_FALLBACK_MS)
  unsubscribe()
})
