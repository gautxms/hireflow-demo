import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

import { requireAuth } from '../middleware/authMiddleware.js'
import { isoOrNull, money } from './subscriptions.js'
import { normalizeParseStatus } from './parseStatus.js'
import { resolveCanonicalParseStatus } from '../services/parseStatusMapper.js'
import { getSupportedWebhookEvents } from '../services/webhookService.js'
import { buildResultsQueryParams, normalizeNumericRange } from '../../../src/components/candidateResultsState.js'

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.payload = body
      return this
    },
  }
}

test('auth middleware accepts bearer token and sets req.userId', () => {
  const originalVerify = jwt.verify
  jwt.verify = () => ({ userId: 42 })

  const req = {
    path: '/api/results',
    headers: {
      authorization: 'Bearer valid-token',
    },
    cookies: {},
  }
  const res = createRes()
  let nextCalled = false

  requireAuth(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(req.userId, 42)

  jwt.verify = originalVerify
})

test('auth middleware rejects missing token with 401', () => {
  const req = {
    path: '/api/results',
    headers: {},
    cookies: {},
  }
  const res = createRes()

  requireAuth(req, res, () => {})

  assert.equal(res.statusCode, 401)
  assert.equal(res.payload?.error, 'Unauthorized')
})

test('auth middleware accepts cookie token when bearer is absent', () => {
  const originalVerify = jwt.verify
  jwt.verify = () => ({ userId: 7 })

  const req = {
    path: '/api/subscriptions/current',
    headers: {},
    cookies: { token: 'cookie-token' },
  }
  const res = createRes()
  let nextCalled = false

  requireAuth(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(req.userId, 7)

  jwt.verify = originalVerify
})

test('billing helpers normalize dates and money formatting', () => {
  assert.equal(money(9900), '$99.00')
  assert.equal(money('94800', 'USD'), '$948.00')
  assert.equal(isoOrNull(null), null)
  assert.equal(isoOrNull('2026-01-15T12:00:00Z'), '2026-01-15T12:00:00.000Z')
})

test('parse status normalization maps queue states to API-safe values', () => {
  assert.equal(normalizeParseStatus('completed', 'queued'), 'complete')
  assert.equal(normalizeParseStatus('failed', 'queued'), 'failed')
  assert.equal(normalizeParseStatus('active', 'queued'), 'processing')
  assert.equal(normalizeParseStatus('waiting', 'queued'), 'queued')
})

test('results query params clamp inverted numeric ranges for stable links', () => {
  const matchRange = normalizeNumericRange({ min: '95', max: '70' }, { min: 0, max: 100 })
  const params = buildResultsQueryParams({
    matchRange,
    sortBy: 'name',
    page: 0,
    pageSize: 500,
  })

  assert.equal(params.get('matchMin'), '70')
  assert.equal(params.get('matchMax'), '95')
  assert.equal(params.get('sortOrder'), 'asc')
  assert.equal(params.get('page'), '1')
  assert.equal(params.get('pageSize'), '100')
})

test('integration webhook catalog exposes stable supported events', () => {
  const events = getSupportedWebhookEvents()
  assert.equal(events.includes('*'), false)
  assert.equal(events.includes('parse.completed'), true)
  assert.equal(events.includes('subscription.activated'), true)
})


test('shared parse status mapper resolves queue and parse-job states to canonical values', () => {
  assert.equal(resolveCanonicalParseStatus({ queueState: 'waiting', parseJobState: 'pending' }), 'queued')
  assert.equal(resolveCanonicalParseStatus({ queueState: 'active', parseJobState: 'retrying' }), 'processing')
  assert.equal(resolveCanonicalParseStatus({ queueState: null, parseJobState: 'retrying' }), 'retrying')
  assert.equal(resolveCanonicalParseStatus({ queueState: null, parseJobState: 'complete' }), 'complete')
})
