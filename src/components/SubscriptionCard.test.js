import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./SubscriptionCard.jsx', import.meta.url), 'utf8')

test('scheduled cancellation displays access-end messaging and no cancel button', () => {
  assert.match(source, /subscriptionState\.isCancellationScheduled && accessUntil/)
  assert.match(source, /Cancellation scheduled|subscriptionState\.statusLabel/)
  assert.match(source, /Access until/)
  assert.doesNotMatch(source, /Cancel Subscription/)
})

test('manageable provider billing state links to billing management', () => {
  assert.match(source, /canRenderBillingPage\(subscriptionState\)/)
  assert.match(source, /const actionHref = canOpenBilling \? '\/billing' : shouldViewPlans \? '\/pricing' : '\/help'/)
  assert.match(source, /const actionLabel = canOpenBilling \? 'Manage plan & billing' : shouldViewPlans \? 'View plans' : 'Contact support'/)
})

test('inactive state links to pricing plans only when there is no cancellation signal', () => {
  assert.match(source, /const shouldViewPlans = !subscriptionState\.hasCancellationSignal && \(subscriptionState\.isFree \|\| \(!subscriptionState\.hasProviderSubscription && !subscriptionState\.hasActivePaidAccess/)
  assert.match(source, /View plans/)
  assert.match(source, /No active subscription|Subscription required/)
})

test('cancellation_scheduled missing date without provider IDs uses support state instead of pricing', () => {
  assert.match(source, /const shouldViewPlans = !subscriptionState\.hasCancellationSignal/)
  assert.match(source, /const actionHref = canOpenBilling \? '\/billing' : shouldViewPlans \? '\/pricing' : '\/help'/)
  assert.match(source, /const actionLabel = canOpenBilling \? 'Manage plan & billing' : shouldViewPlans \? 'View plans' : 'Contact support'/)
})

test('pending_cancellation missing date without provider IDs uses support state instead of pricing', () => {
  assert.match(source, /subscriptionState\.hasCancellationSignal && !subscriptionState\.isCancellationScheduled/)
  assert.match(source, /Contact support/)
  assert.match(source, /\/help/)
})

test('active cancelAtPeriodEnd missing date without provider IDs uses support state instead of pricing', () => {
  assert.match(source, /!subscriptionState\.hasCancellationSignal &&/)
  assert.match(source, /const needsBillingSupport = !canOpenBilling && !shouldViewPlans/)
})

test('active or scheduled states without provider billing identifiers use support state instead of pricing', () => {
  assert.match(source, /const needsBillingSupport = !canOpenBilling && !shouldViewPlans/)
  assert.match(source, /Billing setup needs attention\. Contact support/)
  assert.match(source, /Contact support/)
  assert.match(source, /!subscriptionState\.hasActivePaidAccess/)
})

test('scheduled status badge styling does not fall back to inactive class', () => {
  assert.match(source, /const statusClass = subscriptionState\.isCancellationScheduled\s*\? 'active'/)
})

test('explicit cancellation signal without future date uses cancelled badge styling and cancellation label', () => {
  assert.match(source, /: subscriptionState\.hasCancellationSignal\s*\? 'cancelled'/)
  assert.match(source, /const statusLabel = subscriptionState\.hasCancellationSignal && !subscriptionState\.isCancellationScheduled/)
  assert.match(source, /\? 'Cancellation scheduled'/)
})

test('valid scheduled cancellation with provider billing access keeps billing CTA and Access until', () => {
  assert.match(source, /canRenderBillingPage\(subscriptionState\)/)
  assert.match(source, /Manage plan & billing/)
  assert.match(source, /subscriptionState\.isCancellationScheduled && accessUntil/)
  assert.match(source, /Access until/)
})


test('explicit cancellation signal without future date shows reconciled support copy without access until', () => {
  assert.match(source, /subscriptionState\.hasCancellationSignal && !subscriptionState\.isCancellationScheduled/)
  assert.match(source, /Cancellation is being reconciled\. Contact support if this status does not update\./)
})

test('SubscriptionCard no longer contains direct cancellation or blind checkout workflow', () => {
  assert.doesNotMatch(source, /\/subscriptions\/cancel/)
  assert.doesNotMatch(source, /window\.confirm/)
  assert.doesNotMatch(source, /console\.error/)
  assert.doesNotMatch(source, /\/checkout/)
  assert.doesNotMatch(source, /Reactivate Subscription/)
})
