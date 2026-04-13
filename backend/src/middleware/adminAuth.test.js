import test from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

import { pool } from '../db/client.js'
import {
  createAdminSession,
  listAdminSessions,
  requireAdminAuth,
  revokeAdminSession,
  revokeOtherAdminSessions,
} from './adminAuth.js'

const adminSessions = new Map()
const originalQuery = pool.query.bind(pool)

pool.query = async (queryText, params = []) => {
  const sql = String(queryText).trim()

  if (sql.startsWith('INSERT INTO admin_sessions')) {
    const [sessionId, adminId, email, ipAddress, nowMs, expiresAt] = params
    const nowDate = new Date(Number(nowMs))

    adminSessions.set(sessionId, {
      session_id: sessionId,
      admin_id: adminId,
      email,
      ip_address: ipAddress,
      created_at: adminSessions.get(sessionId)?.created_at || nowDate,
      updated_at: nowDate,
      expires_at: new Date(expiresAt),
    })

    return { rowCount: 1, rows: [] }
  }

  if (sql.startsWith('DELETE FROM admin_sessions WHERE expires_at <=')) {
    const [nowMs] = params
    const now = Number(nowMs)

    for (const [sessionId, session] of adminSessions.entries()) {
      if (new Date(session.expires_at).getTime() <= now) {
        adminSessions.delete(sessionId)
      }
    }

    return { rowCount: 1, rows: [] }
  }

  if (sql.startsWith('SELECT') && sql.includes('FROM admin_sessions') && sql.includes('WHERE session_id = $1')) {
    const [sessionId] = params
    const session = adminSessions.get(sessionId)
    if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
      return { rowCount: 0, rows: [] }
    }

    return { rowCount: 1, rows: [{ session_id: sessionId }] }
  }

  if (sql.startsWith('SELECT session_id, ip_address, created_at, updated_at, expires_at')) {
    const [adminId] = params
    const rows = Array.from(adminSessions.values())
      .filter((session) => String(session.admin_id) === String(adminId))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

    return { rowCount: rows.length, rows }
  }

  if (sql.startsWith('DELETE FROM admin_sessions WHERE session_id = $1')) {
    const [sessionId] = params
    const existed = adminSessions.delete(sessionId)
    return { rowCount: existed ? 1 : 0, rows: [] }
  }

  if (sql.startsWith('DELETE FROM admin_sessions') && sql.includes('admin_id = $1')) {
    const [adminId, currentSessionId] = params
    let removed = 0

    for (const [sessionId, session] of adminSessions.entries()) {
      if (String(session.admin_id) !== String(adminId)) continue
      if (currentSessionId && sessionId === currentSessionId) continue
      adminSessions.delete(sessionId)
      removed += 1
    }

    return { rowCount: removed, rows: [] }
  }

  throw new Error(`Unexpected SQL in adminAuth.test: ${sql}`)
}

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

test.after(() => {
  pool.query = originalQuery
})

test('creates and lists active admin sessions', async () => {
  const one = await createAdminSession({ adminId: 42, email: 'admin@example.com', ipAddress: '127.0.0.1' })
  const two = await createAdminSession({ adminId: 42, email: 'admin@example.com', ipAddress: '127.0.0.1' })

  const sessions = await listAdminSessions(42, one.sessionId)
  assert.equal(sessions.length >= 2, true)
  assert.equal(sessions.some((item) => item.id === one.sessionId && item.isCurrent), true)
  assert.equal(sessions.some((item) => item.id === two.sessionId), true)

  await revokeAdminSession(one.sessionId)
  await revokeAdminSession(two.sessionId)
})

test('requireAdminAuth accepts valid session and rejects revoked session', async () => {
  const created = await createAdminSession({ adminId: 77, email: 'admin@example.com', ipAddress: '127.0.0.1' })

  const req = {
    headers: {},
    cookies: { admin_token: created.token },
    ip: '127.0.0.1',
  }
  const res = createRes()

  let nextCalled = false
  await requireAdminAuth(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(req.admin.id, 77)

  await revokeAdminSession(created.sessionId)

  const revokedReq = {
    headers: {},
    cookies: { admin_token: created.token },
    ip: '127.0.0.1',
  }
  const revokedRes = createRes()
  await requireAdminAuth(revokedReq, revokedRes, () => {})
  assert.equal(revokedRes.statusCode, 401)
  assert.match(revokedRes.body.error, /no longer active/i)
})

test('session timeout is enforced', async () => {
  const staleNow = Date.now() - (16 * 60 * 1000)
  const created = await createAdminSession({
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

  await requireAdminAuth(req, res, () => {})
  assert.equal(res.statusCode, 401)
  assert.match(res.body.error, /(expired due to inactivity|no longer active)/i)
})

test('logout others keeps current session', async () => {
  const current = await createAdminSession({ adminId: 100, email: 'admin@example.com', ipAddress: '127.0.0.1' })
  const other = await createAdminSession({ adminId: 100, email: 'admin@example.com', ipAddress: '127.0.0.1' })
  const differentAdmin = await createAdminSession({ adminId: 101, email: 'other@example.com', ipAddress: '127.0.0.1' })

  const revoked = await revokeOtherAdminSessions(100, current.sessionId)
  assert.equal(revoked >= 1, true)

  const ownSessions = await listAdminSessions(100, current.sessionId)
  assert.equal(ownSessions.length, 1)
  assert.equal(ownSessions[0].id, current.sessionId)

  await revokeAdminSession(current.sessionId)
  await revokeAdminSession(other.sessionId)
  await revokeAdminSession(differentAdmin.sessionId)
})
