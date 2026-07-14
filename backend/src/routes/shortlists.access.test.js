import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import shortlistsRouter from './shortlists.js'
import { pool } from '../db/client.js'

const SHORTLIST_ID = '11111111-1111-4111-8111-111111111111'
const RESUME_ID = '22222222-2222-4222-8222-222222222222'

after(async () => {
  await pool.end().catch(() => {})
})

function createShortlistsApp() {
  const app = express()
  app.use(express.json())
  app.use('/shortlists', shortlistsRouter)
  return app
}

function authHeaders(userId = 42) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
  return {
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`,
    'content-type': 'application/json',
  }
}

async function requestJson(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('read-only subscription states remain blocked from every shortlist mutation', async (t) => {
  const readOnlyStatuses = ['past_due', 'payment_failed', 'inactive', 'cancelled']
  const mutationRequests = [
    { method: 'POST', path: '/shortlists', body: { name: 'Blocked shortlist' } },
    { method: 'PATCH', path: `/shortlists/${SHORTLIST_ID}`, body: { name: 'Blocked update' } },
    { method: 'POST', path: `/shortlists/${SHORTLIST_ID}/archive` },
    { method: 'POST', path: `/shortlists/${SHORTLIST_ID}/unarchive` },
    { method: 'DELETE', path: `/shortlists/${SHORTLIST_ID}` },
    { method: 'POST', path: `/shortlists/${SHORTLIST_ID}/candidates`, body: { resumeId: RESUME_ID } },
    { method: 'POST', path: `/shortlists/${SHORTLIST_ID}/candidates/batch`, body: { resumeIds: [RESUME_ID] } },
    { method: 'DELETE', path: `/shortlists/${SHORTLIST_ID}/candidates/${RESUME_ID}` },
    { method: 'POST', path: `/shortlists/${SHORTLIST_ID}/candidates/batch-remove`, body: { resumeIds: [RESUME_ID] } },
  ]
  let currentStatus = readOnlyStatuses[0]
  const queries = []

  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql)
    queries.push({ sql: text, params, status: currentStatus })

    if (/FROM users/.test(text)) {
      return {
        rows: [{
          id: 42,
          subscription_status: currentStatus,
          cancellation_effective_at: currentStatus === 'cancelled' ? '2025-01-01T00:00:00.000Z' : null,
          current_period_end: null,
        }],
      }
    }

    throw new Error(`Read-only shortlist mutation reached its route handler: ${text}`)
  })

  const app = createShortlistsApp()
  for (const status of readOnlyStatuses) {
    currentStatus = status
    for (const request of mutationRequests) {
      const response = await requestJson(app, request.path, request)
      assert.equal(response.status, 403, `${status} ${request.method} ${request.path}`)
      assert.equal(response.body.error, 'Subscription inactive')
    }
  }

  assert.equal(queries.length, readOnlyStatuses.length * mutationRequests.length)
  assert.equal(queries.every(({ sql, params }) => /FROM users/.test(sql) && params[0] === 42), true)
})
