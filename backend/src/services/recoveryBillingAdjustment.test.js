import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addBillingInterval,
  createRecoveryAdjustmentForAttempt,
  isRecoveryBillingAdjustmentEnabled,
  processRecoveryAdjustment,
  runRecoveryBillingAdjustments,
  selectAuthoritativeCapture,
} from './recoveryBillingAdjustment.js'

function recurringTransaction({
  id = 'txn_1', customerId = 'ctm_1', subscriptionId = 'sub_1', plan = 'monthly', capturedAt = '2026-07-27T00:00:00Z',
} = {}) {
  return {
    id, customer_id: customerId, subscription_id: subscriptionId, origin: 'subscription_recurring', status: 'completed',
    details: { totals: { grand_total: '9900' } },
    payments: [{ id: 'pay_1', status: 'captured', captured_at: capturedAt }],
    items: [{ quantity: 1, price: { id: plan === 'annual' ? 'pri_year' : 'pri_month', billing_cycle: { interval: plan === 'annual' ? 'year' : 'month' } } }],
  }
}

test('calendar targets clamp month ends and leap years in UTC', () => {
  assert.equal(addBillingInterval('2026-01-31T23:55:00Z', 'monthly').toISOString(), '2026-02-28T23:55:00.000Z')
  assert.equal(addBillingInterval('2024-02-29T00:05:00Z', 'annual').toISOString(), '2025-02-28T00:05:00.000Z')
  assert.equal(addBillingInterval('2026-08-31T12:00:00Z', 'monthly').toISOString(), '2026-09-30T12:00:00.000Z')
  assert.equal(addBillingInterval('2026-12-31T23:59:59Z', 'monthly').toISOString(), '2027-01-31T23:59:59.000Z')
})

test('late monthly recovery still anchors one full calendar month from capture', () => {
  assert.equal(addBillingInterval('2026-08-22T09:30:00Z', 'monthly').toISOString(), '2026-09-22T09:30:00.000Z')
})

test('authoritative capture deterministically selects latest valid captured payment', () => {
  const selected = selectAuthoritativeCapture([
    { id: 'pay_a', status: 'captured', captured_at: '2026-07-27T10:00:00Z' },
    { id: 'pay_z', status: 'captured', captured_at: '2026-07-27T10:00:00Z' },
    { id: 'pay_bad', status: 'captured', captured_at: 'invalid' },
    { id: 'pay_later', status: 'failed', captured_at: '2026-07-28T10:00:00Z' },
  ])
  assert.equal(selected.id, 'pay_z')
  assert.equal(selectAuthoritativeCapture([
    { id: 'pay_null', status: 'captured', captured_at: null },
  ]), null)
})

test('environment kill switch is disabled by default and supports sandbox-only rollout', () => {
  assert.equal(isRecoveryBillingAdjustmentEnabled('sandbox', {}), false)
  assert.equal(isRecoveryBillingAdjustmentEnabled('sandbox', { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' }), true)
  assert.equal(isRecoveryBillingAdjustmentEnabled('production', { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' }), false)
})

test('late August recovery PATCHes once from the existing August renewal to September and confirms local dates and anchor', async () => {
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
    { id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-09-22T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
  ]
  const patches = []
  const result = await processRecoveryAdjustment({
    id: 'adj_1', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox', recovery_transaction_id: 'txn_1',
    paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: '2026-08-22T00:00:00Z',
    target_next_billed_at: '2026-09-22T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ capturedAt: '2026-08-22T00:00:00Z' }), getSubscription: async () => subscriptions.shift(),
    patchSubscription: async (id, body, key) => patches.push({ id, body, key }),
  })
  assert.equal(result, 'confirmed')
  assert.deepEqual(patches[0].body, { next_billed_at: '2026-09-22T00:00:00.000Z', proration_billing_mode: 'do_not_bill' })
  assert.equal(Object.hasOwn(patches[0].body, 'items'), false)
  assert.match(calls.find((call) => /UPDATE users/.test(call.sql)).sql, /quota_anchor_at=\$3/)
  assert.deepEqual(calls.find((call) => /UPDATE users/.test(call.sql)).params.slice(1, 3).map((value) => new Date(value).toISOString()), ['2026-09-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z'])
  assert.deepEqual(calls.filter((call) => ['BEGIN', 'COMMIT'].includes(call.sql)).map((call) => call.sql), ['BEGIN', 'COMMIT'])
  assert.equal(released, true)
})

test('already favorable provider date is never shortened', async () => {
  let patched = false
  const db = { async query(sql) { return { rowCount: /^\s*UPDATE (users|recovery_billing_adjustments)/.test(sql) ? 1 : 0, rows: [] } } }
  const result = await processRecoveryAdjustment({
    id: 'adj_2', user_id: 8, status: 'provider_updating', subscription_plan: 'annual', paddle_environment: 'sandbox', recovery_transaction_id: 'txn_2',
    paddle_customer_id: 'ctm_2', paddle_subscription_id: 'sub_2', captured_at: '2026-07-27T00:00:00Z',
    target_next_billed_at: '2027-07-27T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ id: 'txn_2', customerId: 'ctm_2', subscriptionId: 'sub_2', plan: 'annual' }),
    getSubscription: async () => ({ id: 'sub_2', customer_id: 'ctm_2', status: 'active', scheduled_change: null, next_billed_at: '2027-08-01T00:00:00Z', items: [{ price: { id: 'pri_year' } }] }),
    patchSubscription: async () => { patched = true },
  })
  assert.equal(result, 'already_satisfied')
  assert.equal(patched, false)
})

test('Annual recovery moves renewal one calendar year and quota anchor once while preserving monthly allowance semantics', async () => {
  const calls = []
  const subscriptions = [
    { id: 'sub_a', customer_id: 'ctm_a', status: 'active', scheduled_change: null, next_billed_at: '2027-08-20T00:00:00Z', items: [{ price: { id: 'pri_year' } }] },
    { id: 'sub_a', customer_id: 'ctm_a', status: 'active', scheduled_change: null, next_billed_at: '2027-08-22T00:00:00Z', items: [{ price: { id: 'pri_year' } }] },
  ]
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rowCount: /^\s*UPDATE (users|recovery_billing_adjustments)/.test(sql) ? 1 : 0, rows: [] } } }
  const patches = []
  const status = await processRecoveryAdjustment({
    id: 'adj_annual', user_id: 9, status: 'provider_updating', subscription_plan: 'annual', paddle_environment: 'sandbox',
    recovery_transaction_id: 'txn_annual', paddle_customer_id: 'ctm_a', paddle_subscription_id: 'sub_a',
    captured_at: '2026-08-22T00:00:00Z', target_next_billed_at: '2027-08-22T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ id: 'txn_annual', customerId: 'ctm_a', subscriptionId: 'sub_a', plan: 'annual', capturedAt: '2026-08-22T00:00:00Z' }),
    getSubscription: async () => subscriptions.shift(), patchSubscription: async (id, body) => patches.push({ id, body }),
  })
  assert.equal(status, 'confirmed')
  assert.equal(patches[0].body.next_billed_at, '2027-08-22T00:00:00.000Z')
  const userUpdate = calls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.equal(new Date(userUpdate.params[2]).toISOString(), '2026-08-22T00:00:00.000Z')
  assert.match(userUpdate.sql, /quota_anchor_at=\$3/)
})

test('exact sandbox account recovery PATCHes once and a confirmed second run performs no mutation', async () => {
  const subscriptions = [
    { id: 'sub_exact', customer_id: 'ctm_exact', status: 'active', scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
    { id: 'sub_exact', customer_id: 'ctm_exact', status: 'active', scheduled_change: null, next_billed_at: '2026-08-27T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
  ]
  const db = { async query(sql) { return { rowCount: /^\s*UPDATE (users|recovery_billing_adjustments)/.test(sql) ? 1 : 0, rows: [] } } }
  const adjustment = {
    id: 'adj_exact', user_id: 10, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
    recovery_transaction_id: 'txn_exact', paddle_customer_id: 'ctm_exact', paddle_subscription_id: 'sub_exact',
    previous_next_billed_at: '2026-07-23T00:00:00Z', captured_at: '2026-07-27T00:00:00Z', target_next_billed_at: '2026-08-27T00:00:00Z',
  }
  const patches = []
  const dependencies = {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ id: 'txn_exact', customerId: 'ctm_exact', subscriptionId: 'sub_exact' }),
    getSubscription: async () => subscriptions.shift(), patchSubscription: async (id, body) => patches.push({ id, body }),
  }
  assert.equal(await processRecoveryAdjustment(adjustment, dependencies), 'confirmed')
  assert.equal(await processRecoveryAdjustment({ ...adjustment, status: 'confirmed' }, dependencies), 'confirmed')
  assert.equal(patches.length, 1)
  assert.deepEqual(patches[0].body, { next_billed_at: '2026-08-27T00:00:00.000Z', proration_billing_mode: 'do_not_bill' })
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
  assert.match(sql[0].text, /payload->'data'->>'origin'[\s\S]*subscription_recurring[\s\S]*LIMIT 20/)
  assert.match(sql[0].text, /COALESCE\(NULLIF\(LOWER\(a\.paddle_environment\),''\),'production'\)[\s\S]*COALESCE\(NULLIF\(LOWER\(pa\.paddle_environment\),''\),'production'\)/)
  assert.match(sql[0].text, /recovery_adjustment_capture_status',''\) <> 'manual_required'/)
  assert.match(sql[0].text, /pa\.updated_at<=NOW\(\)-INTERVAL '15 minutes'/)
  assert.match(sql[0].text, /recovery_adjustment_discovery_retry_at[\s\S]*timestamptz<=NOW\(\)/)
  assert.match(sql[0].text, /recovery_adjustment_discovery_retry_at[\s\S]*ASC NULLS FIRST/)
  assert.match(sql[0].text, /authoritative_reconciliation', 'subscription_get_reconciliation'[\s\S]*metadata->>'transaction_id' = pa\.transaction_id/)
  assert.match(sql[1].text, /paddle_environment = ANY\(\$1::text\[\]\)[\s\S]*LIMIT 20 FOR UPDATE OF a SKIP LOCKED/)
  assert.match(sql[1].text, /u\.last_paddle_event_at AS observed_last_paddle_event_at/)
  assert.match(sql[1].text, /u\.current_period_end AS observed_current_period_end/)
  assert.deepEqual(sql.map(({ params }) => params), [[['sandbox']], [['sandbox']]])
})

test('authoritative reconciliation discovers only the exact recovered transaction', async () => {
  const attempts = [
    {
      id: 'old_attempt', transaction_id: 'txn_old',
      metadata: { resolved_by: 'authoritative_reconciliation', transaction_id: 'txn_recovered' },
    },
    {
      id: 'recovered_attempt', transaction_id: 'txn_recovered',
      metadata: { resolved_by: 'authoritative_reconciliation', transaction_id: 'txn_recovered' },
    },
  ]
  const created = []
  const db = { async query(sql) {
    if (/SELECT pa\.\*/.test(sql)) {
      const rows = attempts.filter((attempt) => attempt.metadata.transaction_id === attempt.transaction_id)
      return { rows, rowCount: rows.length }
    }
    return { rows: [], rowCount: 0 }
  } }

  await runRecoveryBillingAdjustments({
    db,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    createAdjustment: async (attempt) => created.push(attempt.transaction_id),
  })

  assert.deepEqual(created, ['txn_recovered'])
})

test('permanently ineligible initial checkouts are filtered before LIMIT and cannot starve a recurring recovery', async () => {
  const queries = []
  const created = []
  const responses = [
    { rows: [{ id: 'valid_recurring', payload: { data: { origin: 'subscription_recurring' } } }], rowCount: 1 },
    { rows: [], rowCount: 0 },
  ]
  await runRecoveryBillingAdjustments({
    db: { async query(sql) { queries.push(sql); return responses.shift() } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'production' },
    createAdjustment: async (attempt) => created.push(attempt.id),
  })
  assert.deepEqual(created, ['valid_recurring'])
  assert.match(queries[0], /origin'[\s\S]*= 'subscription_recurring'[\s\S]*ORDER BY[\s\S]*LIMIT 20/)
  assert.match(queries[0], /recovery_adjustment_ineligible/)
})

test('legacy null and blank production environments share adjustment idempotency identity', async () => {
  const sql = []
  const responses = [{ rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }]
  await runRecoveryBillingAdjustments({
    db: { async query(text) { sql.push(text); return responses.shift() } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'production' },
  })
  assert.match(sql[0], /COALESCE\(NULLIF\(LOWER\(a\.paddle_environment\),''\),'production'\)\s*=\s*COALESCE\(NULLIF\(LOWER\(pa\.paddle_environment\),''\),'production'\)/)
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
      id: 'adj_lifecycle', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox', recovery_transaction_id: 'txn_1',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: '2026-07-27T00:00:00Z',
      target_next_billed_at: '2026-08-27T00:00:00Z',
    }, {
      db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month', annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
      getTransaction: async () => recurringTransaction(), getSubscription: async () => subscriptions.shift(), patchSubscription: async () => {}, logError: async () => {},
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
    id: 'adj_race', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox', recovery_transaction_id: 'txn_1',
    paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: captured, target_next_billed_at: confirmed,
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction(), getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: confirmed, items: [{ price: { id: 'pri_month' } }] }),
    logError: async () => {},
  })
  assert.equal(status, 'confirmed')
  assert.ok(transactionCalls.includes('ROLLBACK'))
  assert.equal(transactionCalls.includes('COMMIT'), false)
})

test('a newer Paddle event prevents stale local confirmation and supersedes the adjustment', async () => {
  const transactionCalls = []
  const client = {
    async query(sql, params) {
      transactionCalls.push({ sql, params })
      return { rows: [], rowCount: /UPDATE users/.test(sql) ? 0 : 1 }
    },
    release() {},
  }
  const dbCalls = []
  const db = {
    async connect() { return client },
    async query(sql) {
      dbCalls.push(sql)
      if (/SELECT a\.status/.test(sql)) {
        return { rows: [{
          status: 'provider_updating',
          subscription_status: 'active',
          subscription_plan: 'monthly',
          paddle_customer_id: 'ctm_1',
          paddle_subscription_id: 'sub_1',
          paddle_environment: 'sandbox',
          cancellation_effective_at: null,
          current_period_end: '2026-09-27T00:00:00Z',
          subscription_renewal_date: '2026-09-27T00:00:00Z',
          next_billing_date: '2026-09-27T00:00:00Z',
          quota_anchor_at: '2026-07-27T00:00:00Z',
          last_paddle_event_at: '2026-08-27T00:00:00Z',
        }] }
      }
      return { rows: [], rowCount: 1 }
    },
  }
  const target = '2026-08-27T00:00:00Z'
  const status = await processRecoveryAdjustment({
    id: 'adj_newer_event',
    user_id: 7,
    status: 'provider_updating',
    subscription_plan: 'monthly',
    paddle_environment: 'sandbox',
    recovery_transaction_id: 'txn_1',
    paddle_customer_id: 'ctm_1',
    paddle_subscription_id: 'sub_1',
    captured_at: '2026-07-27T00:00:00Z',
    target_next_billed_at: target,
    observed_last_paddle_event_at: '2026-07-27T00:00:00Z',
    observed_current_period_end: '2026-08-23T00:00:00Z',
    observed_subscription_renewal_date: '2026-08-23T00:00:00Z',
    observed_next_billing_date: '2026-08-23T00:00:00Z',
  }, {
    db,
    paddle: {
      environment: 'sandbox',
      priceIdsByPlan: { monthly: 'pri_month' },
      noTrialPriceIdsByPlan: {},
      legacyPriceIdsByPlan: {},
    },
    getTransaction: async () => recurringTransaction(),
    getSubscription: async () => ({
      id: 'sub_1',
      customer_id: 'ctm_1',
      status: 'active',
      scheduled_change: null,
      next_billed_at: target,
      items: [{ price: { id: 'pri_month' } }],
    }),
    logError: async () => {},
  })

  assert.equal(status, 'superseded')
  const userUpdate = transactionCalls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.match(userUpdate.sql, /last_paddle_event_at IS NOT DISTINCT FROM \$8::timestamptz/)
  assert.match(userUpdate.sql, /current_period_end IS NOT DISTINCT FROM \$9::timestamptz/)
  assert.equal(userUpdate.params[7], '2026-07-27T00:00:00Z')
  assert.ok(dbCalls.some((sql) => /safe_error_code='newer_provider_event'/.test(sql)))
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
    id: 'adj_superseded', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox', recovery_transaction_id: 'txn_1',
    paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: '2026-07-27T00:00:00Z',
    target_next_billed_at: '2026-08-27T00:00:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction(), getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-27T00:00:00Z', items: [{ price: { id: 'pri_month' } }] }),
    logError: async () => {},
  })
  assert.equal(status, 'superseded')
  assert.ok(calls.includes('ROLLBACK'))
  assert.equal(calls.includes('COMMIT'), false)
})

async function processRecoveredRenewals(order) {
  const providerNext = '2026-09-22T09:30:00Z'
  const state = {
    anchor: null,
    current_period_end: null,
    subscription_renewal_date: null,
    next_billing_date: null,
  }
  const statuses = []
  const db = {
    async connect() {
      return {
        async query(sql, params) {
          if (/UPDATE users/.test(sql)) {
            const capturedAt = params[2]
            if (state.anchor && new Date(state.anchor) > new Date(capturedAt)) return { rowCount: 0, rows: [] }
            state.anchor = capturedAt
            state.current_period_end = params[1]
            state.subscription_renewal_date = params[1]
            state.next_billing_date = params[1]
            return { rowCount: 1, rows: [{ id: 7 }] }
          }
          if (/UPDATE recovery_billing_adjustments/.test(sql)) return { rowCount: 1, rows: [] }
          return { rowCount: 0, rows: [] }
        },
        release() {},
      }
    },
    async query(sql) {
      if (/SELECT a\.status/.test(sql)) return { rows: [{
        status: 'provider_updating', subscription_status: 'active', subscription_plan: 'monthly',
        paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', paddle_environment: 'sandbox', cancellation_effective_at: null,
        current_period_end: state.current_period_end, subscription_renewal_date: state.subscription_renewal_date,
        next_billing_date: state.next_billing_date, quota_anchor_at: state.anchor,
      }] }
      return { rowCount: 1, rows: [] }
    },
  }
  for (const capturedAt of order) {
    const transactionId = `txn_${capturedAt.slice(5, 10)}`
    statuses.push(await processRecoveryAdjustment({
      id: `adj_${capturedAt}`, user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      recovery_transaction_id: transactionId, paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', captured_at: capturedAt,
      target_next_billed_at: addBillingInterval(capturedAt, 'monthly').toISOString(),
    }, {
      db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
      getTransaction: async () => recurringTransaction({ id: transactionId, capturedAt }),
      getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: providerNext, items: [{ price: { id: 'pri_month' } }] }),
      logError: async () => {},
    }))
  }
  return { state, statuses }
}

test('two recovered renewals processed oldest-first advance quota anchor monotonically', async () => {
  const result = await processRecoveredRenewals(['2026-07-22T09:30:00Z', '2026-08-22T09:30:00Z'])
  assert.deepEqual(result.statuses, ['already_satisfied', 'already_satisfied'])
  assert.equal(new Date(result.state.anchor).toISOString(), '2026-08-22T09:30:00.000Z')
})

test('two recovered renewals processed newest-first supersede the older adjustment without resetting quota', async () => {
  const result = await processRecoveredRenewals(['2026-08-22T09:30:00Z', '2026-07-22T09:30:00Z'])
  assert.deepEqual(result.statuses, ['already_satisfied', 'superseded'])
  assert.equal(new Date(result.state.anchor).toISOString(), '2026-08-22T09:30:00.000Z')
})

test('historical Monthly recovery is superseded after the same subscription changes to Annual', async () => {
  let patched = false
  const db = { async query() { return { rowCount: 1, rows: [] } } }
  const status = await processRecoveryAdjustment({
    id: 'adj_old_monthly', user_id: 7, status: 'provider_updating', subscription_plan: 'annual', paddle_environment: 'sandbox',
    recovery_transaction_id: 'txn_monthly', paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1',
    captured_at: '2026-07-22T09:30:00Z', target_next_billed_at: '2026-08-22T09:30:00Z',
  }, {
    db, paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month', annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ id: 'txn_monthly', plan: 'monthly', capturedAt: '2026-07-22T09:30:00Z' }),
    getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2027-08-22T09:30:00Z', items: [{ price: { id: 'pri_year' } }] }),
    patchSubscription: async () => { patched = true },
  })
  assert.equal(status, 'superseded')
  assert.equal(patched, false)
})

test('historical Annual recovery is superseded after the same subscription changes to Monthly', async () => {
  let patched = false
  const status = await processRecoveryAdjustment({
    id: 'adj_old_annual', user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
    recovery_transaction_id: 'txn_annual', paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1',
    captured_at: '2026-07-22T09:30:00Z', target_next_billed_at: '2027-07-22T09:30:00Z',
  }, {
    db: { async query() { return { rowCount: 1, rows: [] } } },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month', annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ id: 'txn_annual', plan: 'annual', capturedAt: '2026-07-22T09:30:00Z' }),
    getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-22T09:30:00Z', items: [{ price: { id: 'pri_month' } }] }),
    patchSubscription: async () => { patched = true },
  })
  assert.equal(status, 'superseded')
  assert.equal(patched, false)
})

test('candidate creation rejects a historical Monthly renewal after an Annual plan change', async () => {
  const writes = []
  const db = { async query(sql) {
    writes.push(sql)
    if (/FROM users/.test(sql)) return { rows: [{
      id: 7, subscription_status: 'active', subscription_plan: 'annual', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
    }] }
    return { rows: [], rowCount: 0 }
  } }
  const result = await createRecoveryAdjustmentForAttempt({ id: 1, user_id: 7, transaction_id: 'txn_monthly', paddle_environment: 'sandbox' }, {
    db, env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month', annual: 'pri_year' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction({ id: 'txn_monthly', plan: 'monthly' }),
    getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2027-08-27T00:00:00Z', items: [{ price: { id: 'pri_year' } }] }),
  })
  assert.equal(result, null)
  assert.equal(writes.some((sql) => /INSERT INTO recovery_billing_adjustments/.test(sql)), false)
})

for (const followingStatus of ['ready', 'completed']) {
  test(`following renewal already ${followingStatus} requires manual accounting without a Paddle PATCH`, async () => {
    const updates = []
    let patched = false
    const recovery = recurringTransaction({ capturedAt: '2026-08-22T00:00:00Z' })
    recovery.created_at = '2026-08-22T00:00:00Z'
    const following = recurringTransaction({ id: 'txn_following', capturedAt: '2026-09-22T00:00:00Z' })
    following.created_at = '2026-09-21T00:00:00Z'
    following.status = followingStatus
    const status = await processRecoveryAdjustment({
      id: `adj_following_${followingStatus}`, user_id: 7, status: 'provider_updating', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      recovery_transaction_id: 'txn_1', paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1',
      captured_at: '2026-08-22T00:00:00Z', target_next_billed_at: '2026-09-22T00:00:00Z',
    }, {
      db: { async query(sql, params) { updates.push({ sql, params }); return { rowCount: 1, rows: [] } } },
      paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
      getTransaction: async () => recovery,
      listTransactions: async () => [recovery, following],
      getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }] }),
      patchSubscription: async () => { patched = true },
    })
    assert.equal(status, 'manual_required')
    assert.equal(patched, false)
    assert.match(updates[0].sql, /status='manual_required'/)
    assert.match(updates[0].sql, /safe_error_code='following_renewal_exists'/)
    assert.equal(updates.some(({ sql }) => /UPDATE users/.test(sql)), false)
  })
}

test('deterministically wrong ownership is durably classified instead of rediscovered', async () => {
  const writes = []
  const db = { async query(sql, params) {
    writes.push({ sql, params })
    if (/FROM users/.test(sql)) return { rows: [{
      id: 7, subscription_status: 'active', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_current', paddle_subscription_id: 'sub_current', cancellation_effective_at: null,
    }] }
    return { rowCount: 1, rows: [] }
  } }
  const result = await createRecoveryAdjustmentForAttempt({ id: 99, user_id: 7, transaction_id: 'txn_1', paddle_environment: 'sandbox' }, {
    db, env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction(),
  })
  assert.equal(result, null)
  const classification = writes.find(({ sql }) => /recovery_adjustment_ineligible/.test(sql))
  assert.deepEqual(classification.params, [99, 'subscription_ownership_mismatch'])
})

test('more than 20 permanently ineligible recurring candidates cannot indefinitely starve an older valid recovery', async () => {
  const ineligible = Array.from({ length: 21 }, (_, index) => ({ id: `bad_${index}`, permanentlyIneligible: true }))
  const valid = { id: 'valid_recovery' }
  const remaining = [...ineligible, valid]
  const classified = new Set()
  const created = []
  const db = {
    async query(sql) {
      if (/SELECT pa\.\*/.test(sql)) {
        const rows = remaining.filter((attempt) => !classified.has(attempt.id)).slice(0, 20)
        return { rows, rowCount: rows.length }
      }
      return { rows: [], rowCount: 0 }
    },
  }
  const dependencies = {
    db, env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' }, logError: async () => {},
    createAdjustment: async (attempt) => {
      if (attempt.permanentlyIneligible) classified.add(attempt.id)
      else created.push(attempt.id)
    },
  }
  await runRecoveryBillingAdjustments(dependencies)
  await runRecoveryBillingAdjustments(dependencies)
  assert.equal(classified.size, 21)
  assert.deepEqual(created, ['valid_recovery'])
})

test('transient Past Due subscription stays retryable while later candidates continue', async () => {
  const writes = []
  const result = await createRecoveryAdjustmentForAttempt({ id: 100, user_id: 7, transaction_id: 'txn_1', paddle_environment: 'sandbox' }, {
    db: { async query(sql, params) {
      writes.push({ sql, params })
      if (/FROM users/.test(sql)) return { rows: [{
        id: 7, subscription_status: 'past_due', subscription_plan: 'monthly', paddle_environment: 'sandbox',
        paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
      }] }
      return { rowCount: 1, rows: [] }
    } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => recurringTransaction(),
    getSubscription: async () => ({ id: 'sub_1', customer_id: 'ctm_1', status: 'past_due', scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }] }),
  })
  assert.equal(result, null)
  assert.equal(writes.some(({ sql }) => /recovery_adjustment_ineligible/.test(sql)), false)
  assert.equal(writes.some(({ sql }) => /recovery_adjustment_discovery_retry_at/.test(sql)), true)
})

test('matching recurring transaction that is not completed remains retryable', async () => {
  const writes = []
  const result = await createRecoveryAdjustmentForAttempt({
    id: 104, user_id: 7, transaction_id: 'txn_processing', paddle_environment: 'sandbox',
  }, {
    db: { async query(sql, params) {
      writes.push({ sql, params })
      if (/FROM users/.test(sql)) return { rows: [{
        id: 7, subscription_status: 'past_due', subscription_plan: 'monthly', paddle_environment: 'sandbox',
        paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
      }] }
      return { rowCount: 1, rows: [] }
    } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => ({ ...recurringTransaction({ id: 'txn_processing' }), status: 'paid' }),
  })

  assert.equal(result, null)
  assert.equal(writes.some(({ sql }) => /recovery_adjustment_ineligible/.test(sql)), false)
  const retry = writes.find(({ sql }) => /recovery_adjustment_discovery_retry_at/.test(sql))
  assert.deepEqual(retry.params, [104, 'provider_transaction_not_completed'])
})

test('permanent Paddle transaction lookup failure is durably excluded from discovery', async () => {
  const writes = []
  const error = Object.assign(new Error('not found'), { status: 404 })
  const result = await createRecoveryAdjustmentForAttempt({
    id: 101, user_id: 7, transaction_id: 'txn_deleted', paddle_environment: 'sandbox',
  }, {
    db: { async query(sql, params) { writes.push({ sql, params }); return { rowCount: 1, rows: [] } } },
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox' },
    getTransaction: async () => { throw error },
  })

  assert.equal(result, null)
  assert.equal(writes.length, 1)
  assert.match(writes[0].sql, /recovery_adjustment_ineligible/)
  assert.deepEqual(writes[0].params, [101, 'provider_transaction_unavailable'])
})

for (const [name, status] of [['rate limit', 429], ['provider failure', 503], ['timeout', undefined]]) {
  test(`${name} during transaction lookup remains retryable`, async () => {
    const writes = []
    const error = Object.assign(new Error(name), status ? { status } : {})
    await assert.rejects(
      createRecoveryAdjustmentForAttempt({
        id: `retry_${name}`, user_id: 7, transaction_id: 'txn_retry', paddle_environment: 'sandbox',
      }, {
        db: { async query(sql, params) { writes.push({ sql, params }); return { rowCount: 1, rows: [] } } },
        env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
        paddle: { environment: 'sandbox' },
        getTransaction: async () => { throw error },
      }),
      error,
    )
    assert.equal(writes.some(({ sql }) => /recovery_adjustment_ineligible/.test(sql)), false)
    assert.equal(writes.some(({ sql }) => /recovery_adjustment_discovery_retry_at/.test(sql)), true)
  })
}

test('missing capture timestamp retries durably and can create the adjustment when capture later appears', async () => {
  const writes = []
  let transactionRead = 0
  const db = { async query(sql, params) {
    writes.push({ sql, params })
    if (/FROM users/.test(sql)) return { rows: [{
      id: 7, subscription_status: 'active', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
    }] }
    if (/WITH capture_retry/.test(sql)) return { rows: [{ status: 'retryable_failed' }], rowCount: 1 }
    if (/INSERT INTO recovery_billing_adjustments/.test(sql)) return { rows: [{ id: 'adj_capture' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  } }
  const dependencies = {
    db,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async () => {
      transactionRead += 1
      const transaction = recurringTransaction()
      if (transactionRead === 1) transaction.payments = []
      return transaction
    },
    getSubscription: async () => ({
      id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null,
      next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }],
    }),
  }

  assert.equal(await createRecoveryAdjustmentForAttempt(
    { id: 102, user_id: 7, transaction_id: 'txn_1', paddle_environment: 'sandbox' },
    dependencies,
  ), null)
  assert.deepEqual(await createRecoveryAdjustmentForAttempt(
    { id: 102, user_id: 7, transaction_id: 'txn_1', paddle_environment: 'sandbox' },
    dependencies,
  ), { id: 'adj_capture' })
  assert.equal(writes.filter(({ sql }) => /WITH capture_retry/.test(sql)).length, 1)
  assert.equal(writes.filter(({ sql }) => /INSERT INTO recovery_billing_adjustments/.test(sql)).length, 1)
  assert.equal(writes.some(({ sql }) => /recovery_adjustment_ineligible/.test(sql)), false)
})

test('persistently missing capture timestamp becomes manual required after bounded retries', async () => {
  const captureStates = []
  let attempts = 0
  const db = { async query(sql, params) {
    if (/FROM users/.test(sql)) return { rows: [{
      id: 7, subscription_status: 'active', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
    }] }
    if (/WITH capture_retry/.test(sql)) {
      attempts += 1
      const status = attempts >= params[1] ? 'manual_required' : 'retryable_failed'
      captureStates.push({ status, params, sql })
      return { rows: [{ status }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  } }
  const dependencies = {
    db,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox' },
    getTransaction: async () => ({ ...recurringTransaction(), payments: [] }),
  }

  for (let index = 0; index < 4; index += 1) {
    await createRecoveryAdjustmentForAttempt(
      { id: 103, user_id: 7, transaction_id: 'txn_1', paddle_environment: 'sandbox' },
      dependencies,
    )
  }

  assert.deepEqual(captureStates.map(({ status }) => status), [
    'retryable_failed', 'retryable_failed', 'retryable_failed', 'manual_required',
  ])
  assert.deepEqual(captureStates.at(-1).params, [103, 4])
  assert.match(captureStates.at(-1).sql, /missing_trustworthy_capture/)
})

test('more than 20 permanent transaction 404s cannot starve an older valid recovery', async () => {
  const attempts = [
    ...Array.from({ length: 21 }, (_, index) => ({
      id: `missing_${index}`, user_id: 7, transaction_id: `txn_missing_${index}`, paddle_environment: 'sandbox',
    })),
    { id: 'valid', user_id: 7, transaction_id: 'txn_valid', paddle_environment: 'sandbox' },
  ]
  const classified = new Set()
  const created = []
  const db = { async query(sql, params) {
    if (/SELECT pa\.\*/.test(sql)) {
      const rows = attempts.filter((attempt) => !classified.has(attempt.id)).slice(0, 20)
      return { rows, rowCount: rows.length }
    }
    if (/UPDATE payment_attempts/.test(sql)) {
      classified.add(params[0])
      return { rows: [], rowCount: 1 }
    }
    if (/FROM users/.test(sql)) return { rows: [{
      id: 7, subscription_status: 'active', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
    }] }
    if (/INSERT INTO recovery_billing_adjustments/.test(sql)) {
      created.push(params[4])
      return { rows: [{ id: 'adj_valid' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  } }
  const dependencies = {
    db,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async (transactionId) => {
      if (transactionId !== 'txn_valid') throw Object.assign(new Error('not found'), { status: 404 })
      return recurringTransaction({ id: 'txn_valid' })
    },
    getSubscription: async () => ({
      id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null,
      next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }],
    }),
    logError: async () => {},
  }

  await runRecoveryBillingAdjustments(dependencies)
  await runRecoveryBillingAdjustments(dependencies)

  assert.equal(classified.size, 21)
  assert.deepEqual(created, ['txn_valid'])
})

test('more than 20 transient candidates are deferred so an older valid recovery is discovered', async () => {
  const attempts = [
    ...Array.from({ length: 21 }, (_, index) => ({
      id: `transient_${index}`, user_id: 7, transaction_id: `txn_transient_${index}`,
      paddle_environment: 'sandbox', retryScheduled: false,
    })),
    { id: 'valid', user_id: 7, transaction_id: 'txn_valid', paddle_environment: 'sandbox', retryScheduled: false },
  ]
  const created = []
  let currentTransactionId = ''
  const db = { async query(sql, params) {
    if (/SELECT pa\.\*/.test(sql)) {
      const rows = attempts.filter((attempt) => !attempt.retryScheduled).slice(0, 20)
      return { rows, rowCount: rows.length }
    }
    if (/recovery_adjustment_discovery_retry_at/.test(sql) && /UPDATE payment_attempts/.test(sql)) {
      attempts.find((attempt) => attempt.id === params[0]).retryScheduled = true
      return { rows: [], rowCount: 1 }
    }
    if (/FROM users/.test(sql)) return { rows: [{
      id: 7, subscription_status: 'past_due', subscription_plan: 'monthly', paddle_environment: 'sandbox',
      paddle_customer_id: 'ctm_1', paddle_subscription_id: 'sub_1', cancellation_effective_at: null,
    }] }
    if (/INSERT INTO recovery_billing_adjustments/.test(sql)) {
      created.push(params[4])
      return { rows: [{ id: 'adj_valid' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  } }
  const dependencies = {
    db,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: { environment: 'sandbox', priceIdsByPlan: { monthly: 'pri_month' }, noTrialPriceIdsByPlan: {}, legacyPriceIdsByPlan: {} },
    getTransaction: async (transactionId) => {
      currentTransactionId = transactionId
      return recurringTransaction({ id: transactionId })
    },
    getSubscription: async () => ({
      id: 'sub_1', customer_id: 'ctm_1',
      status: currentTransactionId === 'txn_valid' ? 'active' : 'past_due',
      scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z',
      items: [{ price: { id: 'pri_month', billing_cycle: { interval: 'month' } } }],
    }),
    logError: async () => {},
  }

  await runRecoveryBillingAdjustments(dependencies)
  await runRecoveryBillingAdjustments(dependencies)

  assert.equal(attempts.filter((attempt) => attempt.retryScheduled).length, 21)
  assert.deepEqual(created, ['txn_valid'])
})
