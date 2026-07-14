import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import jobDescriptionsRouter from './jobDescriptions.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'

const OWNED_JOB_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_JOB_ID = '99999999-9999-4999-8999-999999999999'

after(async () => {
  await pool.end().catch(() => {})
})

function createJobDescriptionsApp() {
  const app = express()
  app.use(express.json())
  app.use('/job-descriptions', requireAuth, jobDescriptionsRouter)
  return app
}

function authHeaders(userId = 42) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
  return {
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`,
    'content-type': 'application/json',
  }
}

function persistedJobDescriptionRow() {
  return {
    id: OWNED_JOB_ID,
    user_id: 42,
    title: 'Historical Frontend Engineer',
    description: 'Stored historical job description',
    requirements: 'React',
    responsibilities: 'Build accessible interfaces',
    skills: ['React', 'Accessibility'],
    additional_info: '',
    experience_years: 4,
    experience_min: 3,
    experience_max: 5,
    location: 'Remote',
    salary_min: null,
    salary_max: null,
    salary_currency: 'USD',
    department: 'Engineering',
    employment_type: 'full-time',
    priority: 0,
    archived_reason: null,
    source_type: 'manual',
    version: 1,
    file_url: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  }
}

async function requestJson(app, path, { authenticated = true, method = 'GET', body } = {}) {
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: authenticated ? authHeaders() : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('app mount allows authenticated job description reads while route mutations retain paid guards', () => {
  const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  const routeSource = readFileSync(new URL('./jobDescriptions.js', import.meta.url), 'utf8')

  assert.match(
    appSource,
    /app\.use\('\/api\/job-descriptions', requireAuth, generalApiLimiterAuth, jobDescriptionsRoutes\)/,
  )
  assert.doesNotMatch(
    appSource,
    /app\.use\('\/api\/job-descriptions',[^\n]*requireActiveSubscription/,
  )
  assert.match(routeSource, /router\.post\('\/', requireActiveSubscription,/)
  assert.match(routeSource, /router\.put\('\/:id', requireActiveSubscription,/)
  assert.match(routeSource, /router\.delete\('\/:id', requireActiveSubscription,/)
  assert.match(routeSource, /router\.post\('\/:id\/duplicate', requireActiveSubscription,/)
})

test('job description reads still require authentication', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    throw new Error(`Unauthenticated request reached the database: ${String(sql)}`)
  })

  const { status, body } = await requestJson(createJobDescriptionsApp(), '/job-descriptions', {
    authenticated: false,
  })

  assert.equal(status, 401)
  assert.equal(body.error, 'Unauthorized')
})

test('authenticated historical reads return only owner-scoped job descriptions', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql)
    queries.push({ sql: text, params })

    if (/CREATE TABLE IF NOT EXISTS job_descriptions/.test(text)) return { rows: [] }

    if (/SELECT jd\.\*\s+FROM job_descriptions jd/.test(text)) {
      assert.match(text, /WHERE jd\.user_id = \$1/)
      assert.deepEqual(params, [42, false])
      return { rows: [persistedJobDescriptionRow()] }
    }

    if (/SELECT \* FROM job_descriptions/.test(text)) {
      assert.match(text, /WHERE id = \$1 AND user_id = \$2/)
      return { rows: params[0] === OWNED_JOB_ID && params[1] === 42 ? [persistedJobDescriptionRow()] : [] }
    }

    if (/SELECT file_url FROM job_descriptions/.test(text)) {
      assert.match(text, /WHERE id = \$1 AND user_id = \$2/)
      return { rows: [] }
    }

    throw new Error(`Unexpected historical-read query: ${text}`)
  })

  const app = createJobDescriptionsApp()
  const listResponse = await requestJson(app, '/job-descriptions')
  const ownedResponse = await requestJson(app, `/job-descriptions/${OWNED_JOB_ID}`)
  const otherUserResponse = await requestJson(app, `/job-descriptions/${OTHER_USER_JOB_ID}`)
  const otherUserAttachmentResponse = await requestJson(app, `/job-descriptions/${OTHER_USER_JOB_ID}/attachment`)

  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.items.length, 1)
  assert.equal(listResponse.body.items[0].id, OWNED_JOB_ID)
  assert.equal(ownedResponse.status, 200)
  assert.equal(ownedResponse.body.item.id, OWNED_JOB_ID)
  assert.equal(otherUserResponse.status, 404)
  assert.equal(otherUserResponse.body.error, 'Job description not found')
  assert.equal(otherUserAttachmentResponse.status, 404)
  assert.equal(otherUserAttachmentResponse.body.error, 'Job description not found')
  assert.equal(queries.some(({ sql }) => /FROM users/.test(sql)), false)
  assert.equal(
    queries.some(({ sql }) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+job_descriptions\b/i.test(sql)),
    false,
  )
})

test('read-only subscription states remain blocked from every job description mutation', async (t) => {
  const readOnlyStatuses = ['past_due', 'payment_failed', 'inactive', 'cancelled']
  const mutationRequests = [
    { method: 'POST', path: '/job-descriptions', body: { title: 'Blocked create' } },
    { method: 'PUT', path: `/job-descriptions/${OWNED_JOB_ID}`, body: { title: 'Blocked update' } },
    { method: 'DELETE', path: `/job-descriptions/${OWNED_JOB_ID}` },
    { method: 'POST', path: `/job-descriptions/${OWNED_JOB_ID}/duplicate` },
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

    throw new Error(`Read-only mutation reached route handler: ${text}`)
  })

  const app = createJobDescriptionsApp()
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
  assert.equal(
    queries.some(({ sql }) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+job_descriptions\b/i.test(sql)),
    false,
  )
})
