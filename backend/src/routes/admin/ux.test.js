/* global process, setImmediate */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import app from '../../app.js'
import { pool } from '../../db/client.js'
import { createAdminSession } from '../../middleware/adminAuth.js'
import { parseQueue } from '../../services/jobQueue.js'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

after(async () => {
  await parseQueue.close().catch(() => {})
})

async function postAdminUxEvent({ headers } = {}) {
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/api/admin/ux/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: JSON.stringify({
        eventType: 'admin_filter_used',
        route: '/admin/analytics',
        metadata: { filter: 'status' },
      }),
    })
    const payload = await response.json()
    return { response, payload }
  } finally {
    server.close()
  }
}

async function postAdminUxFeedback({ headers, body } = {}) {
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/api/admin/ux/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: JSON.stringify(body || {
        route: '/admin/analytics',
        isUseful: true,
        comment: 'Helpful dashboard',
      }),
    })
    const payload = await response.json()
    return { response, payload }
  } finally {
    server.close()
  }
}

function setupPoolMock(t) {
  const sessions = new Map()
  const events = []
  const adminActions = []
  const feedback = []

  t.mock.method(pool, 'query', async (queryText, params = []) => {
    const sql = String(queryText).trim()

    if (sql.startsWith('DELETE FROM admin_sessions WHERE expires_at <=')) {
      const [nowMs] = params
      for (const [sessionId, session] of sessions.entries()) {
        if (new Date(session.expires_at).getTime() <= Number(nowMs)) {
          sessions.delete(sessionId)
        }
      }
      return { rowCount: 0, rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_sessions')) {
      const [sessionId, adminId, email, ipAddress, nowMs, expiresAt] = params
      sessions.set(sessionId, {
        session_id: sessionId,
        admin_id: adminId,
        email,
        ip_address: ipAddress,
        updated_at: new Date(Number(nowMs)),
        expires_at: new Date(expiresAt),
      })
      return { rowCount: 1, rows: [] }
    }

    if (sql.startsWith('SELECT session_id') && sql.includes('FROM admin_sessions')) {
      const [sessionId] = params
      const session = sessions.get(sessionId)
      if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 1, rows: [{ session_id: sessionId }] }
    }

    if (sql.startsWith('DELETE FROM admin_sessions WHERE session_id = $1')) {
      sessions.delete(params[0])
      return { rowCount: 1, rows: [] }
    }

    if (sql.startsWith('INSERT INTO events')) {
      events.push({ params })
      return { rowCount: 1, rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_actions')) {
      adminActions.push({ params })
      return { rowCount: 1, rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_page_feedback')) {
      feedback.push({ params })
      return { rowCount: 1, rows: [] }
    }

    throw new Error(`Unexpected SQL in admin ux app test: ${sql}`)
  })

  return { events, adminActions, feedback }
}

function bearerToken(payload) {
  return { Authorization: `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}` }
}

test('production app rejects POST /api/admin/ux/events without a token before recording an event', async (t) => {
  const { events, adminActions } = setupPoolMock(t)

  const { response, payload } = await postAdminUxEvent()

  assert.equal(response.status, 401)
  assert.match(payload.error, /admin authentication required/i)
  assert.equal(events.length, 0)
  assert.equal(adminActions.length, 0)
})

test('production app forbids POST /api/admin/ux/events with a valid non-admin user token', async (t) => {
  const { events, adminActions } = setupPoolMock(t)

  const { response, payload } = await postAdminUxEvent({
    headers: bearerToken({ userId: 123, isAdmin: false }),
  })

  assert.equal(response.status, 403)
  assert.match(payload.error, /admin access requires verified 2fa/i)
  assert.equal(events.length, 0)
  assert.equal(adminActions.length, 0)
})

test('production app accepts POST /api/admin/ux/events with admin auth and audits exactly once', async (t) => {
  const { events, adminActions } = setupPoolMock(t)
  const created = await createAdminSession({
    adminId: 7,
    email: 'admin@example.com',
    ipAddress: '127.0.0.1',
  })

  const { response, payload } = await postAdminUxEvent({
    headers: { Authorization: `Bearer ${created.token}` },
  })

  // Allow the response finish audit hook to run before asserting captured admin audit inserts.
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(response.status, 202)
  assert.deepEqual(payload, { ok: true })
  assert.equal(events.length, 1)
  assert.equal(events[0].params[0], 7)
  assert.equal(events[0].params[1], 'admin_filter_used')
  assert.equal(adminActions.length, 1)
})

test('production app rejects POST /api/admin/ux/feedback without a token before side effects', async (t) => {
  const { events, adminActions, feedback } = setupPoolMock(t)

  const { response, payload } = await postAdminUxFeedback()

  assert.equal(response.status, 401)
  assert.match(payload.error, /admin authentication required/i)
  assert.equal(feedback.length, 0)
  assert.equal(events.length, 0)
  assert.equal(adminActions.length, 0)
})

test('production app forbids POST /api/admin/ux/feedback with a valid non-admin user token before side effects', async (t) => {
  const { events, adminActions, feedback } = setupPoolMock(t)

  const { response, payload } = await postAdminUxFeedback({
    headers: bearerToken({ userId: 123, isAdmin: false }),
  })

  assert.equal(response.status, 403)
  assert.match(payload.error, /admin access requires verified 2fa/i)
  assert.equal(feedback.length, 0)
  assert.equal(events.length, 0)
  assert.equal(adminActions.length, 0)
})

test('production app accepts POST /api/admin/ux/feedback with admin auth and audits exactly once', async (t) => {
  const { events, adminActions, feedback } = setupPoolMock(t)
  const created = await createAdminSession({
    adminId: 7,
    email: 'admin@example.com',
    ipAddress: '127.0.0.1',
  })

  const { response, payload } = await postAdminUxFeedback({
    headers: { Authorization: `Bearer ${created.token}` },
  })

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(response.status, 201)
  assert.deepEqual(payload, { ok: true })
  assert.equal(feedback.length, 1)
  assert.equal(feedback[0].params[0], 7)
  assert.equal(feedback[0].params[1], '/admin/analytics')
  assert.equal(feedback[0].params[2], true)
  assert.equal(feedback[0].params[3], 'Helpful dashboard')
  assert.equal(events.length, 1)
  assert.equal(events[0].params[0], 7)
  assert.equal(events[0].params[1], 'admin_page_feedback_submitted')
  assert.equal(adminActions.length, 1)
})

test('production app rejects invalid POST /api/admin/ux/feedback payload and audits exactly once', async (t) => {
  const { events, adminActions, feedback } = setupPoolMock(t)
  const created = await createAdminSession({
    adminId: 7,
    email: 'admin@example.com',
    ipAddress: '127.0.0.1',
  })

  const { response, payload } = await postAdminUxFeedback({
    headers: { Authorization: `Bearer ${created.token}` },
    body: {
      route: '/admin/analytics',
      isUseful: 'yes',
      comment: 'Invalid payload',
    },
  })

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(response.status, 400)
  assert.match(payload.error, /isUseful must be boolean/i)
  assert.equal(feedback.length, 0)
  assert.equal(events.length, 0)
  assert.equal(adminActions.length, 1)
  assert.equal(adminActions[0].params[3].includes('"statusCode":400'), true)
})
