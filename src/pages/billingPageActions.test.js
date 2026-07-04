import test from 'node:test'
import assert from 'node:assert/strict'
import { canShowCancelAction, getBillingPlanAction, getBillingStatusLabel, getCancelActionLabel, getCancellationAccessMessage, getCancellationSuccessMessage, hasScheduledCancellation } from './billingPageActions.js'

const NOW = new Date('2026-07-03T00:00:00Z')

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

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
  assert.equal(getCancelActionLabel(subscription.plan), 'Cancel renewal')
})

test('active reactivated subscription with stale future cancellation date keeps active status and cancel action', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', latestRecordStatus: 'active', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }

  assert.equal(hasScheduledCancellation(subscriptionState, subscription, NOW), false)
  assert.equal(getBillingStatusLabel(subscriptionState, subscription, () => '1/7/2027', NOW), 'Active')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
})

test('scheduled subscription with future cancellation date shows active until status and hides cancel action', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', latestRecordStatus: 'cancelled', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(hasScheduledCancellation(subscriptionState, subscription, NOW), true)
  assert.equal(getBillingStatusLabel(subscriptionState, subscription, format, NOW), 'Active until 1/7/2027')
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, format, NOW), 'Your access remains active until 1/7/2027. You will not be charged again.')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
})

test('canceled subscription with future cancellation date shows active until status and hides cancel action', () => {
  const subscriptionState = { statusLabel: 'Canceled', canManageBilling: true, isCanceled: true }
  const subscription = { plan: 'annual', status: 'canceled', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(getBillingStatusLabel(subscriptionState, subscription, format, NOW), 'Active until 1/7/2027')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
})

test('fresh cancel response with effectiveAt uses renewal canceled access wording', () => {
  const subscription = { plan: 'annual' }
  const payload = { effectiveAt: '2027-01-07T00:00:00Z', message: 'Subscription cancelled. A confirmation email will be sent by webhook processing.' }
  const format = () => '1/7/2027'

  assert.equal(getCancellationSuccessMessage(subscription, payload, format), 'Renewal canceled. Your access remains active until 1/7/2027.')
})

test('monthly cancellation path remains available before a cancellation is scheduled', () => {
  const subscriptionState = { canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'monthly', status: 'active' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
  assert.equal(getCancelActionLabel(subscription.plan), 'Cancel subscription')
})
