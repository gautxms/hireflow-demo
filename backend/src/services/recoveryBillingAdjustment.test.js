import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addBillingInterval,
  isRecoveryBillingAdjustmentEnabled,
  processRecoveryAdjustment,
  runRecoveryBillingAdjustments,
  selectAuthoritativeCapture,
} from './recoveryBillingAdjustment.js'

test('calendar targets clamp month ends and leap years in UTC', () => {
  assert.equal(addBillingInterval('2026-01-31T23:55:00Z', 'monthly').toISOString(), '2026-02-28T23:55:00.000Z')
  assert.equal(addBillingInterval('2024-02-29T00:05:00Z', 'annual').toISOString(), '2025-02-28T00:05:00.000Z')
  assert.equal(addBillingInterval('2026-08-31T12:00:00Z', 'monthly').toISOString(), '2026-09-30T12:00:00.000Z')
  assert.equal(addBillingInterval('2026-12-31T23:59:59Z', 'monthly').toISOString(), '2027-01-31T23:59:59.000Z')
})

test('late monthly recovery still anchors one full calendar month from capture', () => {
  assert.equal(addBillingInterval('2026-07-01T00:01:00Z', 'monthly').toISOString(), '2026-08-01T00:01:00.000Z')
})

test('authoritative capture deterministically selects latest valid captured payment', () => {
  const selected = selectAuthoritativeCapture([
    { id: 'pay_a', status: 'captured', captured_at: '2026-07-27T10:00:00Z' },
    { id: 'pay_z', status: 'captured', captured_at: '2026-07-27T10:00:00Z' },
    { id: 'pay_bad', status: 'captured', captured_at: 'invalid' },
    { id: 'pay_later', status: 'failed', captured_at: '2026-07-28T10:00:00Z' },
  ])
  assert.equal(selected.id, 'pay_z')
})

test('environment kill switch is disabled by default and supports sandbox-only rollout', () => {
  assert.equal(isRecoveryBillingAdjustmentEnabled('sandbox', {}), false)
  assert.equal(isRecoveryBillingAdjustmentEnabled('sandbox', { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' }), true)
  assert.equal(isRecoveryBillingAdjustmentEnabled('production', { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' }), false)
})

test('monthly recovery PATCHes only next_billed_at with do_not_bill then confirms local dates and anchor', async () => {
  const calls = []
  let released = false
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      return { rowCount: /^\s*UPDATE (users|recovery_billing_adjustments)/.test(sql) ? 1 : 0, rows: [] }
    },
    release() { released = true },
  }
  const db = {
    async connect() { return client },
    async query() { assert.fail('transaction queries must use the checked-out client') },
  }
  const subscriptions = [
    { id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
    { id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-27T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
  ]
  const patches = []
  const result = await processRecoveryAdjustment({
    id: 'adj_1', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
    paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: '2026-07-27T00:00:00Z',
    target_next_billed_at: '2026-08-27T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getSubscription: async () => subscriptions.shift(),
    patchSubscription: async (id, body, key) => patches.push({ id, body, key }),
  })
  assert.equal(result, 'confirmed')
  assert.deepEqual(patches[0].body, { next_billed_at: '2026-08-27T00:00:00.000Z', proration_billing_mode: 'do_not_bill' })
  assert.equal(Object.hasOwn(patches[0].body, 'items'), false)
  assert.match(calls.find((call) => /UPDATE users/.test(call.sql)).sql, /quota_anchor_at=\$3/)
  assert.deepEqual(calls.filter((call) => ['BEGIN', 'COMMIT'].includes(call.sql)).map((call) => call.sql), ['BEGIN', 'COMMIT'])
  assert.equal(released, true)
})

test('already favorable provider date is never shortened', async () => {
  let patched = false
  const db = { async query(sql) { return { rowCount: /^\s*UPDATE (users|recovery_billing_adjustments)/.test(sql) ? 1 : 0, rows: [] } } }
  const result = await processRecoveryAdjustment({
    id: 'adj_2', user_id: 8, status: 'provider_updating', subscription_plan: 'annual', paddle_environment: 'sandbox',
    paddle_customer_id: 'ctm_2', paddle_subscription_id: 'sub_2', captured_at: '2026-07-27T00:00:00Z',
    target_next_billed_at: '2027-07-27T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getSubscription: async () => ({ id: 'sub_2', customer_id: 'ctm_2', status: 'active', scheduled_change: null, next_billed_at: '2027-08-01T00:00:00Z', items: [{ price: { id: 'pri_year' } }] }),
    patchSubscription: async () => { patched = true },
  })
  assert.equal(result, 'already_satisfied')
  assert.equal(patched, false)
})

test('due adjustments are not processed when their environment kill switch is disabled', async () => {
  const queries = [
    { rows: [], rowCount: 0 },
    { rows: [
      { id: 'adj_sandbox', paddle_environment: 'sandbox' },
      { id: 'adj_production', paddle_environment: 'production' },
    ], rowCount: 2 },
  ]
  const processed = []
  const count = await runRecoveryBillingAdjustments({
    db: { async query() { return queries.shift() } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    processAdjustment: async (adjustment) => processed.push(adjustment.id),
  })

  assert.equal(count, 2)
  assert.deepEqual(processed, ['adj_sandbox'])
  assert.match(String(queries.length), /0/)
})

test('scheduler filters enabled environments before both limits and isolates candidate failures', async () => {
  const sql = []
  const created = []
  const errors = []
  const responses = [
    { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 },
    { rows: [], rowCount: 0 },
  ]
  await runRecoveryBillingAdjustments({
    db: { async query(text, params) { sql.push({ text, params }); return responses.shift() } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    createAdjustment: async (attempt) => {
      created.push(attempt.id)
      if (attempt.id === 1) throw new Error('invalid candidate')
    },
    logError: async (event, error, context) => errors.push({ event, error, context }),
  })

  assert.deepEqual(created, [1, 2])
  assert.equal(errors[0].event, 'recovery_billing_adjustment.discovery_failed')
  assert.match(sql[0].text, /paddle_environment[\s\S]*ANY\(\$1::text\[\]\)[\s\S]*LIMIT 20/)
  assert.match(sql[1].text, /paddle_environment = ANY\(\$1::text\[\]\)[\s\S]*LIMIT 20 FOR UPDATE OF a SKIP LOCKED/)
  assert.deepEqual(sql.map(({ params }) => params), [[['sandbox']], [['sandbox']]])
})

test('atomic claiming prevents concurrent schedulers from processing the same adjustment', async () => {
  let claimed = false
  const processed = []
  const db = {
    async query(sql) {
      if (/SELECT pa\.\*/.test(sql)) return { rows: [], rowCount: 0 }
      if (!claimed) {
        claimed = true
        return { rows: [{ id: 'adj_1', paddle_environment: 'sandbox', status: 'provider_updating' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  }
  const dependencies = {
    db,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    processAdjustment: async (adjustment) => processed.push(adjustment.id),
  }

  await Promise.all([runRecoveryBillingAdjustments(dependencies), runRecoveryBillingAdjustments(dependencies)])
  assert.deepEqual(processed, ['adj_1'])
})

test('one Paddle processing failure does not abort later claimed adjustments', async () => {
  const responses = [
    { rows: [], rowCount: 0 },
    { rows: [
      { id: 'adj_bad', paddle_environment: 'sandbox' },
      { id: 'adj_good', paddle_environment: 'sandbox' },
    ], rowCount: 2 },
  ]
  const processed = []
  const errors = []
  await runRecoveryBillingAdjustments({
    db: { async query() { return responses.shift() } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    processAdjustment: async (adjustment) => {
      processed.push(adjustment.id)
      if (adjustment.id === 'adj_bad') throw new Error('Paddle unavailable')
    },
    logError: async (event) => errors.push(event),
  })
  assert.deepEqual(processed, ['adj_bad', 'adj_good'])
  assert.deepEqual(errors, ['recovery_billing_adjustment.processing_failed'])
})

for (const [name, changedSubscription] of [
  ['cancellation during adjustment', { scheduled_change: { action: 'cancel' } }],
  ['plan change during adjustment', { items: [{ price: { id: 'pri_year' } }] }],
]) {
  test(`${name} supersedes after the Paddle PATCH without committing local dates`, async () => {
    const calls = []
    const base = { id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }] }
    const subscriptions = [base, { ...base, next_billed_at: '2026-08-27T00:00:00Z', ...changedSubscription }]
    const db = { async query(sql) { calls.push(sql); return { rows: [], rowCount: 1 } } }
    const status = await processRecoveryAdjustment({
      id: 'adj_lifecycle', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: '2026-07-27T00:00:00Z',
      target_next_billed_at: '2026-08-27T00:00:00Z',
    }, {
      db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month', annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
      getSubscription: async () => subscriptions.shift(), patchSubscription: async () => {}, logError: async () => {},
    })
    assert.equal(status, 'superseded')
    assert.equal(calls.some((sql) => /UPDATE users/.test(sql)), false)
  })
}

test('a lost local race after provider success self-heals an already-applied projection', async () => {
  const transactionCalls = []
  const confirmed = '2026-08-27T00:00:00Z'
  const captured = '2026-07-27T00:00:00Z'
  const client = {
    async query(sql) {
      transactionCalls.push(sql)
      return { rows: [], rowCount: /UPDATE users/.test(sql) ? 0 : 1 }
    },
    release() {},
  }
  const db = {
    async connect() { return client },
    async query(sql) {
      if (/SELECT a\.status/.test(sql)) return { rows: [{
        status: 'provider_updating', subscription_status: 'active', subscription_plan: 'monthly',
        paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', paddle_environment: 'sandbox', cancellation_effective_at: null,
        current_period_end: confirmed, subscription_renewal_date: confirmed, next_billing_date: confirmed, quota_anchor_at: captured,
      }] }
      return { rowCount: 1, rows: [] }
    },
  }
  const status = await processRecoveryAdjustment({
    id: 'adj_race', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
    paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: captured, target_next_billed_at: confirmed,
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: confirmed, items: [{ price: { id: 'pri_month' } }] }),
    logError: async () => {},
  })
  assert.equal(status, 'confirmed')
  assert.ok(transactionCalls.includes('ROLLBACK'))
  assert.equal(transactionCalls.includes('COMMIT'), false)
})

test('zero-row adjustment confirmation rolls back local billing dates and preserves concurrent supersession', async () => {
  const calls = []
  const client = {
    async query(sql) {
      calls.push(sql)
      if (/UPDATE users/.test(sql)) return { rowCount: 1, rows: [{ id: 7 }] }
      if (/UPDATE recovery_billing_adjustments/.test(sql)) return { rowCount: 0, rows: [] }
      return { rowCount: 0, rows: [] }
    },
    release() {},
  }
  const db = {
    async connect() { return client },
    async query(sql) {
      if (/SELECT a\.status/.test(sql)) return { rows: [{ status: 'superseded' }] }
      return { rowCount: 0, rows: [] }
    },
  }
  const status = await processRecoveryAdjustment({
    id: 'adj_superseded', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
    paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: '2026-07-27T00:00:00Z',
    target_next_billed_at: '2026-08-27T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-27T00:00:00Z', items: [{ price: { id: 'pri_month' } }] }),
    logError: async () => {},
  })
  assert.equal(status, 'superseded')
  assert.ok(calls.includes('ROLLBACK'))
  assert.equal(calls.includes('COMMIT'), false)
})
