import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import {
  getEventDeduplicationId,
  mapToSubscriptionStatus,
  verifyPaddleSignature,
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
  assert.equal(mapToSubscriptionStatus('transaction.completed', {}), 'active')
  assert.equal(mapToSubscriptionStatus('subscription.cancelled', {}), 'cancelled')
})
