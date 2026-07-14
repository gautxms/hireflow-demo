import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import reportsRouter from './reports.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'

after(async () => {
  await pool.end().catch(() => {})
})

function createReportsApp() {
  const app = express()
  app.use(express.json())
  app.use('/reports', requireAuth, reportsRouter)
  return app
}

function authHeaders(userId = 42) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
  return {
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`,
    'content-type': 'application/json',
  }
}

async function request(app, path, { authenticated = true, method = 'GET', body } = {}) {
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: authenticated ? authHeaders() : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const responseBody = response.status === 204 ? null : await response.json()
    return { status: response.status, body: responseBody }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('reports mount allows authenticated reads while every mutation retains a paid guard', () => {
  const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  const routeSource = readFileSync(new URL('./reports.js', import.meta.url), 'utf8')

  assert.match(appSource, /app\.use\('\/api\/reports', requireAuth, generalApiLimiterAuth, reportsRoutes\)/)
  assert.match(routeSource, /router\.get\('\/', async/)
  assert.match(routeSource, /router\.post\('\/', requireActiveSubscription,/)
  assert.match(routeSource, /router\.put\('\/:id', requireActiveSubscription,/)
  assert.match(routeSource, /router\.delete\('\/:id', requireActiveSubscription,/)
})

test('authenticated report reads are owner-scoped and do not perform mutations', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql)
    queries.push({ sql: text, params })
    assert.match(text, /FROM report_definitions[\s\S]*WHERE user_id = \$1/)
    assert.deepEqual(params, [42])
    return {
      rows: [{
        id: 'report-1', user_id: 42, name: 'Historical hiring report', filters: {}, columns: ['candidateName', 'score'],
        schedule_enabled: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      }],
    }
  })

  const response = await request(createReportsApp(), '/reports')
  assert.equal(response.status, 200)
  assert.equal(response.body.items.length, 1)
  assert.equal(response.body.items[0].ownerId, 42)
  assert.equal(queries.some(({ sql }) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+report_definitions\b/i.test(sql)), false)
})

test('read-only subscription states cannot create, update, or delete report definitions', async (t) => {
  const statuses = ['past_due', 'payment_failed', 'inactive', 'cancelled']
  const mutations = [
    { method: 'POST', path: '/reports', body: { name: 'Blocked report' } },
    { method: 'PUT', path: '/reports/report-1', body: { name: 'Blocked update' } },
    { method: 'DELETE', path: '/reports/report-1' },
  ]
  let currentStatus = statuses[0]
  const queries = []

  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql)
    queries.push({ sql: text, params })
    if (/FROM users/.test(text)) {
      return { rows: [{ id: 42, subscription_status: currentStatus, cancellation_effective_at: null, current_period_end: null }] }
    }
    throw new Error(`Read-only report mutation reached its route handler: ${text}`)
  })

  const app = createReportsApp()
  for (const status of statuses) {
    currentStatus = status
    for (const mutation of mutations) {
      const response = await request(app, mutation.path, mutation)
      assert.equal(response.status, 403, `${status} ${mutation.method}`)
      assert.equal(response.body.error, 'Subscription inactive')
    }
  }

  assert.equal(queries.length, statuses.length * mutations.length)
  assert.equal(queries.every(({ sql, params }) => /FROM users/.test(sql) && params[0] === 42), true)
  assert.equal(queries.some(({ sql }) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+report_definitions\b/i.test(sql)), false)
})
