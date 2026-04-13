import test from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

import {
  createAdminSession,
  listAdminSessions,
  requireAdminAuth,
  revokeAdminSession,
  revokeOtherAdminSessions,
} from './adminAuth.js'

function createRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    cookie(name, value) {
      this.cookies[name] = value
    },
    clearCookie(name) {
      delete this.cookies[name]
      this.clearedCookie = name
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
  }
}

test('creates and lists active admin sessions', () => {
  const one = createAdminSession({ adminId: 42, email: 'admin@example.com', ipAddress: '127.0.0.1' })
  const two = createAdminSession({ adminId: 42, email: 'admin@example.com', ipAddress: '127.0.0.1' })

  const sessions = listAdminSessions(42, one.sessionId)
  assert.equal(sessions.length >= 2, true)
  assert.equal(sessions.some((item) => item.id === one.sessionId && item.isCurrent), true)
  assert.equal(sessions.some((item) => item.id === two.sessionId), true)

  revokeAdminSession(one.sessionId)
  revokeAdminSession(two.sessionId)
})

test('requireAdminAuth accepts valid session and rejects revoked session', () => {
  const created = createAdminSession({ adminId: 77, email: 'admin@example.com', ipAddress: '127.0.0.1' })

  const req = {
    headers: {},
    cookies: { admin_token: created.token },
    ip: '127.0.0.1',
  }
  const res = createRes()

  let nextCalled = false
  requireAdminAuth(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(req.admin.id, 77)

  revokeAdminSession(created.sessionId)

  const revokedReq = {
    headers: {},
    cookies: { admin_token: created.token },
    ip: '127.0.0.1',
  }
  const revokedRes = createRes()
  requireAdminAuth(revokedReq, revokedRes, () => {})
  assert.equal(revokedRes.statusCode, 401)
  assert.match(revokedRes.body.error, /no longer active/i)
})

test('session timeout is enforced', () => {
  const staleNow = Date.now() - (16 * 60 * 1000)
  const created = createAdminSession({
    adminId: 88,
    email: 'admin@example.com',
    ipAddress: '127.0.0.1',
    now: staleNow,
  })

  const req = {
    headers: {},
    cookies: { admin_token: created.token },
    ip: '127.0.0.1',
  }
  const res = createRes()

  requireAdminAuth(req, res, () => {})
  assert.equal(res.statusCode, 401)
  assert.match(res.body.error, /(expired due to inactivity|no longer active)/i)
})

test('logout others keeps current session', () => {
  const current = createAdminSession({ adminId: 100, email: 'admin@example.com', ipAddress: '127.0.0.1' })
  const other = createAdminSession({ adminId: 100, email: 'admin@example.com', ipAddress: '127.0.0.1' })
  const differentAdmin = createAdminSession({ adminId: 101, email: 'other@example.com', ipAddress: '127.0.0.1' })

  const revoked = revokeOtherAdminSessions(100, current.sessionId)
  assert.equal(revoked >= 1, true)

  const ownSessions = listAdminSessions(100, current.sessionId)
  assert.equal(ownSessions.length, 1)
  assert.equal(ownSessions[0].id, current.sessionId)

  revokeAdminSession(current.sessionId)
  revokeAdminSession(other.sessionId)
  revokeAdminSession(differentAdmin.sessionId)
})
