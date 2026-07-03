import test from 'node:test'
import assert from 'node:assert/strict'
import { canShowCancelAction, getBillingPlanAction, getBillingStatusLabel, getCancelActionLabel, getCancellationAccessMessage, getCancellationSuccessMessage } from './billingPageActions.js'

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

test('annual active user without cancellation date can cancel renewal', () => {
  const subscriptionState = { canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, new Date('2026-07-03T00:00:00Z')), true)
  assert.equal(getCancelActionLabel(subscription.plan), 'Cancel renewal')
})

test('annual user with future cancellation date does not see active cancel renewal action', () => {
  const subscriptionState = { canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, new Date('2026-07-03T00:00:00Z')), false)
})

test('annual user with future cancellation date sees active until status and access note', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(getBillingStatusLabel(subscriptionState, subscription, format), 'Active until 1/7/2027')
  assert.equal(getCancellationAccessMessage(subscription, format), 'Your access remains active until 1/7/2027. You will not be charged again.')
})

test('cancel success message uses renewal canceled access wording', () => {
  const subscription = { plan: 'annual' }
  const payload = { cancellationEffectiveAt: '2027-01-07T00:00:00Z', message: 'Subscription cancelled. A confirmation email will be sent by webhook processing.' }
  const format = () => '1/7/2027'

  assert.equal(getCancellationSuccessMessage(subscription, payload, format), 'Renewal canceled. Your access remains active until 1/7/2027.')
})

test('monthly cancellation path remains available before a cancellation is scheduled', () => {
  const subscriptionState = { canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'monthly', status: 'active' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, new Date('2026-07-03T00:00:00Z')), true)
  assert.equal(getCancelActionLabel(subscription.plan), 'Cancel subscription')
})
