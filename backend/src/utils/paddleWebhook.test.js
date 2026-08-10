import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import {
  getEventDeduplicationId,
  getPaddleSubscriptionLifecycleProjection,
  mapToSubscriptionStatus,
  normalizePaddleSubscriptionStatus,
  verifyPaddleSignature,
  getTransactionSubscriptionId,
} from './paddleWebhook.js'

test('verifyPaddleSignature accepts valid HMAC-SHA256 signatures', () => {
  const body = JSON.stringify({ event_type: 'transaction.completed', event_id: 'evt_123' })
  const secret = 'super-secret'
  const timestamp = 1_700_000_000
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}:${body}`, 'utf8')
    .digest('hex')

  const result = verifyPaddleSignature(body, `ts=${timestamp};h1=${sig}`, secret, {
    nowMs: timestamp * 1000,
    maxAgeSeconds: 300,
  })

  assert.equal(result.isValid, true)
  assert.equal(result.reason, null)
})

test('verifyPaddleSignature rejects invalid signatures', () => {
  const body = JSON.stringify({ event_type: 'transaction.completed', event_id: 'evt_123' })
  const result = verifyPaddleSignature(body, 'ts=1700000000;h1=abcdef', 'super-secret', {
    nowMs: 1_700_000_000_000,
    maxAgeSeconds: 300,
  })

  assert.equal(result.isValid, false)
  assert.equal(result.reason, 'signature_mismatch')
})

test('verifyPaddleSignature rejects replayed/expired timestamps', () => {
  const body = JSON.stringify({ event_type: 'transaction.completed' })
  const secret = 'super-secret'
  const timestamp = 1_700_000_000
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}:${body}`, 'utf8')
    .digest('hex')

  const result = verifyPaddleSignature(body, `ts=${timestamp};h1=${sig}`, secret, {
    nowMs: (timestamp + 301) * 1000,
    maxAgeSeconds: 300,
  })

  assert.equal(result.isValid, false)
  assert.equal(result.reason, 'timestamp_out_of_range')
})

test('getEventDeduplicationId returns event id and falls back to payload hash', () => {
  const withId = getEventDeduplicationId({ event_id: 'evt_abc' }, '{}')
  assert.equal(withId, 'evt_abc')

  const fallback = getEventDeduplicationId({}, '{"a":1}')
  assert.match(fallback, /^hash:[a-f0-9]{64}$/)
})

test('mapToSubscriptionStatus maps lifecycle events', () => {
  assert.equal(mapToSubscriptionStatus('subscription.created', { data: { status: 'trialing' } }), 'trialing')
  assert.equal(mapToSubscriptionStatus('subscription.activated', { data: { status: 'active' } }), 'active')
  assert.equal(mapToSubscriptionStatus('subscription.past_due', { data: { status: 'past_due' } }), 'past_due')
  assert.equal(mapToSubscriptionStatus('subscription.paused', { data: { status: 'paused' } }), 'paused')
  assert.equal(mapToSubscriptionStatus('subscription.resumed', { data: { status: 'active' } }), 'active')
  assert.equal(mapToSubscriptionStatus('transaction.completed', {}), 'active')
  assert.equal(mapToSubscriptionStatus('subscription.cancelled', {}), 'cancelled')
  assert.equal(mapToSubscriptionStatus('customer.updated', {}), null)
})

test('subscription lifecycle normalization fails closed for unknown or contradictory provider state', () => {
  assert.equal(normalizePaddleSubscriptionStatus('canceled'), 'cancelled')
  assert.equal(normalizePaddleSubscriptionStatus('mystery'), null)
  assert.deepEqual(
    getPaddleSubscriptionLifecycleProjection('subscription.updated', { data: { status: 'mystery' } }),
    { eventType: 'subscription.updated', status: null, reason: 'unsupported_provider_status' },
  )
  assert.deepEqual(
    getPaddleSubscriptionLifecycleProjection('subscription.resumed', { data: { status: 'paused' } }),
    { eventType: 'subscription.resumed', status: null, reason: 'event_status_mismatch' },
  )
})

test('refund events never invent a subscription lifecycle status', () => {
  assert.equal(mapToSubscriptionStatus('transaction.refunded', { data: { status: 'refunded' } }), null)
  assert.equal(getPaddleSubscriptionLifecycleProjection('transaction.refunded', {}), null)
})


test('getTransactionSubscriptionId prefers subscription_id and never transaction id', () => {
  const payload = { data: { id: 'txn_123', subscription_id: 'sub_456' } }
  assert.equal(getTransactionSubscriptionId(payload), 'sub_456')
  assert.notEqual(getTransactionSubscriptionId(payload), 'txn_123')
})

test('mapToSubscriptionStatus maps Paddle transaction failures to payment_failed', () => {
  assert.equal(mapToSubscriptionStatus('transaction.failed', {}), 'payment_failed')
  assert.equal(mapToSubscriptionStatus('transaction.payment_failed', {}), 'payment_failed')
})

test('mapToSubscriptionStatus passes through subscription.updated past_due', () => {
  assert.equal(mapToSubscriptionStatus('subscription.updated', { data: { status: 'past_due' } }), 'past_due')
})
