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

test('active and scheduled states link to billing management', () => {
  assert.match(source, /subscriptionState\.isActive/)
  assert.match(source, /subscriptionState\.isCancellationScheduled/)
  assert.match(source, /const actionHref = shouldManageBilling \? '\/billing' : '\/pricing'/)
  assert.match(source, /const actionLabel = shouldManageBilling \? 'Manage plan & billing' : 'View plans'/)
})

test('inactive state links to pricing plans', () => {
  assert.match(source, /const actionHref = shouldManageBilling \? '\/billing' : '\/pricing'/)
  assert.match(source, /View plans/)
  assert.match(source, /No active subscription|Subscription required/)
})

test('SubscriptionCard no longer contains direct cancellation or blind checkout workflow', () => {
  assert.doesNotMatch(source, /\/subscriptions\/cancel/)
  assert.doesNotMatch(source, /window\.confirm/)
  assert.doesNotMatch(source, /console\.error/)
  assert.doesNotMatch(source, /\/checkout/)
  assert.doesNotMatch(source, /Reactivate Subscription/)
})
