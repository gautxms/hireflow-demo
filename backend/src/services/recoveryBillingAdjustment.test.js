import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addBillingInterval,
  isRecoveryBillingAdjustmentEnabled,
  processRecoveryAdjustment,
  selectAuthoritativeCapture,
} from './recoveryBillingAdjustment.js'

test('calendar targets clamp month ends and leap years in UTC', () => {
  assert.equal(addBillingInterval('2026-01-31T23:55:00Z', 'monthly').toISOString(), '2026-02-28T23:55:00.000Z')
  assert.equal(addBillingInterval('2024-02-29T00:05:00Z', 'annual').toISOString(), '2025-02-28T00:05:00.000Z')
  assert.equal(addBillingInterval('2026-08-31T12:00:00Z', 'monthly').toISOString(), '2026-09-30T12:00:00.000Z')
  assert.equal(addBillingInterval('2026-12-31T23:59:59Z', 'monthly').toISOString(), '2027-01-31T23:59:59.000Z')
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
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rowCount: /UPDATE users/.test(sql) ? 1 : 0, rows: [] } } }
  const subscriptions = [
    { id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-23T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
    { id: 'sub_1', customer_id: 'ctm_1', status: 'active', scheduled_change: null, next_billed_at: '2026-08-27T00:00:00Z', items: [{ price: { id: 'pri_month' } }] },
  ]
  const patches = []
  const result = await processRecoveryAdjustment({
    id: 'adj_1', user_id: 7, status: 'pending', subscription_plan: 'monthly', paddle_environment: 'sandbox',
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
})

test('already favorable provider date is never shortened', async () => {
  let patched = false
  const db = { async query(sql) { return { rowCount: /UPDATE users/.test(sql) ? 1 : 0, rows: [] } } }
  const result = await processRecoveryAdjustment({
    id: 'adj_2', user_id: 8, status: 'pending', subscription_plan: 'annual', paddle_environment: 'sandbox',
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
