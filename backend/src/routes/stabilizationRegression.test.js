import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

import { requireAuth } from '../middleware/authMiddleware.js'
import { isoOrNull, money } from './subscriptions.js'

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

test('billing helpers normalize dates and money formatting', () => {
  assert.equal(money(9900), '$99.00')
  assert.equal(money('94800', 'USD'), '$948.00')
  assert.equal(isoOrNull(null), null)
  assert.equal(isoOrNull('2026-01-15T12:00:00Z'), '2026-01-15T12:00:00.000Z')
})
