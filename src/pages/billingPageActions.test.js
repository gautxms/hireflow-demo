import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canShowCancelAction, getBillingMetadataRows, getBillingPlanAction, getBillingStatusLabel, getCancelActionLabel, getCancellationAccessMessage, getCancellationSuccessMessage, getPastDueBillingAction, getPastDueBillingNotice, hasScheduledCancellation, isPastDueBillingState, shouldRenderBillingHistory, shouldShowPlanActionSupportNote } from './billingPageActions.js'

const NOW = new Date('2026-07-03T00:00:00Z')


test('past_due monthly users do not see annual upgrade plan action', () => {
  const subscriptionState = { isPastDue: true, canManageBilling: true, hasProviderSubscription: true }

  assert.equal(getBillingPlanAction('monthly', subscriptionState), null)
})


test('payment_failed billing state is treated as past due and gets payment CTA', () => {
  const subscriptionState = { rawStatus: 'payment_failed', canManageBilling: true, hasProviderSubscription: true }
  const action = getPastDueBillingAction(subscriptionState)

  assert.equal(isPastDueBillingState(subscriptionState), true)
  assert.equal(getBillingPlanAction('monthly', subscriptionState), null)
  assert.equal(action.label, 'Contact support to resolve billing')
  assert.equal(action.href, '/account/payment-method')
})

test('past_due billing state shows payment-required notice and payment CTA', () => {
  const subscriptionState = { isPastDue: true, canManageBilling: true, hasProviderSubscription: true }
  const action = getPastDueBillingAction(subscriptionState)

  assert.equal(action.label, 'Contact support to resolve billing')
  assert.equal(action.href, '/account/payment-method')
  assert.equal(getPastDueBillingNotice(), 'Payment is required to continue. Your workspace is read-only until billing is resolved.')
})

test('past_due metadata replaces renewal language with payment labels without workspace access duplication', () => {
  const rows = getBillingMetadataRows(
    { isPastDue: true, canManageBilling: true },
    { status: 'past_due', nextBillingDate: '2026-07-15T00:00:00Z', renewalDate: '2026-08-15T00:00:00Z', paymentMethod: 'Card on file' },
    () => '7/15/2026',
    NOW,
  )

  assert.deepEqual(rows.map((row) => row.label), ['Retry date', 'Payment method'])
  assert.equal(rows[1].value, 'Card on file')
  assert.equal(rows.some((row) => row.label === 'Workspace access'), false)
})


test('past_due metadata uses payment due when retry date is missing', () => {
  const rows = getBillingMetadataRows(
    { isPastDue: true, canManageBilling: true },
    { status: 'past_due', paymentMethod: 'Visa ending in 4242' },
    () => 'formatted date',
    NOW,
  )

  assert.deepEqual(rows.map((row) => row.label), ['Payment due', 'Payment method'])
  assert.equal(rows[0].value, 'Now')
  assert.equal(rows[1].value, 'Visa ending in 4242')
})

test('payment_failed metadata matches past_due compact payment rows', () => {
  const rows = getBillingMetadataRows(
    { rawStatus: 'payment_failed', canManageBilling: true },
    { status: 'payment_failed', nextBillingDate: '2026-07-15T00:00:00Z', paymentMethod: 'Mastercard ending in 5555' },
    () => '7/15/2026',
    NOW,
  )

  assert.deepEqual(rows.map((row) => row.label), ['Retry date', 'Payment method'])
  assert.equal(rows.some((row) => row.label === 'Workspace access'), false)
})

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


test('scheduled cancellation hides monthly-billing support note for annual plans', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const planAction = getBillingPlanAction(subscription.plan)

  assert.equal(shouldShowPlanActionSupportNote(planAction, subscriptionState, subscription, NOW), false)
})

test('normal active annual plan still shows monthly-billing support note', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active' }
  const planAction = getBillingPlanAction(subscription.plan)

  assert.equal(shouldShowPlanActionSupportNote(planAction, subscriptionState, subscription, NOW), true)
  assert.equal(planAction.label, 'Need monthly billing? Contact support and we’ll help update your billing cadence safely.')
})

test('scheduled cancellation still shows resume-support access note', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, format, NOW), 'Subscription canceled. Your access remains active until 1/7/2027. You will not be charged again.')
  assert.equal(shouldShowPlanActionSupportNote(getBillingPlanAction(subscription.plan), subscriptionState, subscription, NOW), false)
})

test('cancel action uses subscription copy for monthly and annual plans', () => {
  assert.equal(getCancelActionLabel('monthly'), 'Cancel subscription')
  assert.equal(getCancelActionLabel('annual'), 'Cancel subscription')
})

test('annual active user without cancellation date can cancel subscription', () => {
  const subscriptionState = { canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
  assert.equal(getCancelActionLabel(subscription.plan), 'Cancel subscription')
})

test('active reactivated subscription with stale future cancellation date keeps active status and cancel action', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', latestRecordStatus: 'active', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }

  assert.equal(hasScheduledCancellation(subscriptionState, subscription, NOW), false)
  assert.equal(getBillingStatusLabel(subscriptionState, subscription, () => '1/7/2027', NOW), 'Active')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
})


test('active subscription with future cancellationEffectiveAt but no backend schedule signal keeps cancel action', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }

  assert.equal(hasScheduledCancellation(subscriptionState, subscription, NOW), false)
  assert.equal(getBillingStatusLabel(subscriptionState, subscription, () => '1/7/2027', NOW), 'Active')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
})



test('active cancelAtPeriodEnd with missing date hides cancel and shows reconciled copy', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, hasCancellationSignal: true }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, (value) => value, NOW), 'Cancellation is being reconciled. Contact support if this status does not update.')
})

test('active cancelAtPeriodEnd with malformed date hides cancel and shows reconciled copy', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: 'not-a-date' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, (value) => value, NOW), 'Cancellation is being reconciled. Contact support if this status does not update.')
})

test('active cancelAtPeriodEnd with past date hides cancel and shows reconciled copy', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: '2025-01-07T00:00:00Z' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, (value) => value, NOW), 'Cancellation is being reconciled. Contact support if this status does not update.')
})

test('cancellation_scheduled with missing date hides cancel', () => {
  const subscriptionState = { statusLabel: 'Cancellation scheduled', canManageBilling: true }
  const subscription = { plan: 'annual', status: 'cancellation_scheduled' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, (value) => value, NOW), 'Cancellation is being reconciled. Contact support if this status does not update.')
})

test('pending_cancellation with provider IDs and missing date hides cancel', () => {
  const subscriptionState = { statusLabel: 'Cancellation scheduled', canManageBilling: true }
  const subscription = { plan: 'annual', status: 'pending_cancellation', paddleCustomerId: 'ctm_123', paddleSubscriptionId: 'sub_123' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, (value) => value, NOW), 'Cancellation is being reconciled. Contact support if this status does not update.')
})

test('subscription with cancelAtPeriodEnd true and future cancellationEffectiveAt shows access until', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(hasScheduledCancellation(subscriptionState, subscription, NOW), true)
  assert.equal(getBillingStatusLabel(subscriptionState, subscription, format, NOW), 'Access until 1/7/2027')
})

test('scheduled cancellation hides cancel subscription and returns access message', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', cancelAtPeriodEnd: true, cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, format, NOW), 'Subscription canceled. Your access remains active until 1/7/2027. You will not be charged again.')
})

test('scheduled subscription with future cancellation date shows active until status and hides cancel action', () => {
  const subscriptionState = { statusLabel: 'Active', canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'annual', status: 'active', latestRecordStatus: 'cancelled', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(hasScheduledCancellation(subscriptionState, subscription, NOW), true)
  assert.equal(getBillingStatusLabel(subscriptionState, subscription, format, NOW), 'Access until 1/7/2027')
  assert.equal(getCancellationAccessMessage(subscriptionState, subscription, format, NOW), 'Subscription canceled. Your access remains active until 1/7/2027. You will not be charged again.')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
})

test('canceled subscription with future cancellation date shows active until status and hides cancel action', () => {
  const subscriptionState = { statusLabel: 'Canceled', canManageBilling: true, isCanceled: true }
  const subscription = { plan: 'annual', status: 'canceled', cancellationEffectiveAt: '2027-01-07T00:00:00Z' }
  const format = () => '1/7/2027'

  assert.equal(getBillingStatusLabel(subscriptionState, subscription, format, NOW), 'Access until 1/7/2027')
  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), false)
})

test('fresh cancel response with effectiveAt uses subscription canceled access wording', () => {
  const subscription = { plan: 'annual' }
  const payload = { effectiveAt: '2027-01-07T00:00:00Z', message: 'Subscription cancelled. A confirmation email will be sent by webhook processing.' }
  const format = () => '1/7/2027'

  assert.equal(getCancellationSuccessMessage(subscription, payload, format), 'Subscription canceled. Your access remains active until 1/7/2027.')
})

test('monthly cancellation path remains available before a cancellation is scheduled', () => {
  const subscriptionState = { canManageBilling: true, isCanceled: false }
  const subscription = { plan: 'monthly', status: 'active' }

  assert.equal(canShowCancelAction(subscriptionState, subscription, NOW), true)
  assert.equal(getCancelActionLabel(subscription.plan), 'Cancel subscription')
})

test('billing history is hidden when invoice history is empty or unavailable', () => {
  assert.equal(shouldRenderBillingHistory([]), false)
  assert.equal(shouldRenderBillingHistory(null), false)
})

test('billing history renders when invoice rows exist', () => {
  assert.equal(shouldRenderBillingHistory([{ id: 'inv_123', canDownload: true }]), true)
})

test('BillingPage past-due CTA uses visible button text and SPA navigation', () => {
  const source = readFileSync(new URL('./BillingPage.jsx', import.meta.url), 'utf8')

  assert.match(source, /<button type="button" className="hf-btn hf-btn--primary" onClick=\{\(\) => navigateInternal\(pastDueAction\.href\)\}>/)
  assert.match(source, /\{pastDueAction\.label\}/)
  assert.doesNotMatch(source, /<a className="hf-btn hf-btn--primary" href=\{pastDueAction\.href\}>/)
})

test('BillingPage past-due copy is rendered only through the compact notice helper', () => {
  const source = readFileSync(new URL('./BillingPage.jsx', import.meta.url), 'utf8')

  assert.match(source, /pastDueBillingNotice \? <p className="billing-page__past-due-note">\{pastDueBillingNotice\}<\/p> : null/)
  assert.doesNotMatch(source, /Workspace access/)
  assert.doesNotMatch(source, /Read-only until billing is resolved/)
})
