import test from 'node:test'
import assert from 'node:assert/strict'
import {
  firstNormalizedPaddleTimestamp,
  normalizePaddleTimestamp,
} from './paddleTimestamps.js'

test('Paddle timestamps are normalized to the same UTC instant before storage', () => {
  assert.equal(
    normalizePaddleTimestamp('2026-02-01T05:00:00+05:30'),
    '2026-01-31T23:30:00.000Z',
  )
  assert.equal(
    normalizePaddleTimestamp('2026-01-31T18:30:00-05:00'),
    '2026-01-31T23:30:00.000Z',
  )
  assert.equal(normalizePaddleTimestamp('invalid'), null)
})

test('Paddle timestamp fallback returns the first valid normalized instant', () => {
  assert.equal(
    firstNormalizedPaddleTimestamp(null, 'invalid', '2026-01-31T23:30:00Z'),
    '2026-01-31T23:30:00.000Z',
  )
})
