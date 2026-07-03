import test from 'node:test'
import assert from 'node:assert/strict'
import { getBillingPlanAction, getCancelActionLabel } from './billingPageActions.js'

test('monthly billing users see annual upgrade as the self-serve plan action', () => {
  const action = getBillingPlanAction('monthly')

  assert.equal(action.label, 'Upgrade to annual')
  assert.equal(action.targetPlan, 'annual')
  assert.equal(action.isSelfServe, true)
})

test('annual billing users do not see a self-serve monthly downgrade action', () => {
  const action = getBillingPlanAction('annual')

  assert.notEqual(action.label, 'Downgrade to monthly')
  assert.equal(action.targetPlan, 'monthly')
  assert.equal(action.isSelfServe, false)
})

test('cancel action remains visible with annual renewal copy', () => {
  assert.equal(getCancelActionLabel('monthly'), 'Cancel subscription')
  assert.equal(getCancelActionLabel('annual'), 'Cancel renewal')
})
