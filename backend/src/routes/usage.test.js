import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import usageRouter, {
  buildResumeAnalysisUsageResponse,
  resolveResumeAnalysisUsageWarningLevel,
} from './usage.js'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

function buildApp() {
  const app = express()
  app.use('/usage', requireAuth, usageRouter)
  return app
}

function authHeader(userId) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

async function requestUsage({ headers } = {}) {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}/usage/resume-analysis`, { headers })
    const payload = await response.json()
    return { response, payload }
  } finally {
    server.close()
  }
}

test('resolveResumeAnalysisUsageWarningLevel follows resume analysis meter thresholds', () => {
  const limit = 800

  assert.equal(resolveResumeAnalysisUsageWarningLevel(0, limit), 'none')
  assert.equal(resolveResumeAnalysisUsageWarningLevel(599, limit), 'none')
  assert.equal(resolveResumeAnalysisUsageWarningLevel(600, limit), 'approaching')
  assert.equal(resolveResumeAnalysisUsageWarningLevel(719, limit), 'approaching')
  assert.equal(resolveResumeAnalysisUsageWarningLevel(720, limit), 'critical')
  assert.equal(resolveResumeAnalysisUsageWarningLevel(799, limit), 'critical')
  assert.equal(resolveResumeAnalysisUsageWarningLevel(800, limit), 'exceeded')
})

test('buildResumeAnalysisUsageResponse exposes UI-ready quota fields', () => {
  const periodStart = new Date('2026-05-01T00:00:00.000Z')
  const payload = buildResumeAnalysisUsageResponse({ limit: 800, used: 600, periodStart })

  assert.deepEqual(payload, {
    limit: 800,
    used: 600,
    remaining: 200,
    periodStart: '2026-05-01T00:00:00.000Z',
    periodEnd: '2026-06-01T00:00:00.000Z',
    percentageUsed: 75,
    warningLevel: 'approaching',
  })
})

test('GET /usage/resume-analysis requires authentication', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queries = []
  t.mock.method(pool, 'query', async (sql) => {
    queries.push(sql)
    return { rows: [] }
  })

  const { response, payload } = await requestUsage()

  assert.equal(response.status, 401)
  assert.equal(payload.error, 'Unauthorized')
  assert.equal(queries.length, 0)
})

test('GET /usage/resume-analysis returns paid active user usage without mutating usage records', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queries = []

  t.mock.method(pool, 'query', async (sql) => {
    queries.push(sql)

    if (sql.includes('FROM users')) return { rows: [{ id: 7, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 720 }] }
    return { rows: [] }
  })

  const { response, payload } = await requestUsage({ headers: authHeader(7) })

  assert.equal(response.status, 200)
  assert.equal(payload.limit, 800)
  assert.equal(payload.used, 720)
  assert.equal(payload.remaining, 80)
  assert.equal(payload.percentageUsed, 90)
  assert.equal(payload.warningLevel, 'critical')
  assert.match(payload.periodStart, /^\d{4}-\d{2}-01T00:00:00\.000Z$/)
  assert.match(payload.periodEnd, /^\d{4}-\d{2}-01T00:00:00\.000Z$/)
  assert.equal(queries.some((sql) => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql)), false)
})

test('GET /usage/resume-analysis reflects admin limit and reset overrides', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queries = []

  t.mock.method(pool, 'query', async (sql) => {
    queries.push(sql)

    if (sql.includes('FROM users')) return { rows: [{ id: 8, subscription_status: 'trialing' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [{ upload_limit: 25, reset_usage: true }] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 24 }] }
    return { rows: [] }
  })

  const { response, payload } = await requestUsage({ headers: authHeader(8) })

  assert.equal(response.status, 200)
  assert.equal(payload.limit, 25)
  assert.equal(payload.used, 0)
  assert.equal(payload.remaining, 25)
  assert.equal(payload.warningLevel, 'none')
  assert.equal(queries.some((sql) => sql.includes('FROM usage_log')), false)
})

test('GET /usage/resume-analysis preserves trial/free limit resolution', async (t) => {
  process.env.JWT_SECRET = 'test-secret'

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 9, subscription_status: 'inactive' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 10 }] }
    return { rows: [] }
  })

  const { response, payload } = await requestUsage({ headers: authHeader(9) })

  assert.equal(response.status, 200)
  assert.equal(payload.limit, 10)
  assert.equal(payload.used, 10)
  assert.equal(payload.remaining, 0)
  assert.equal(payload.percentageUsed, 100)
  assert.equal(payload.warningLevel, 'exceeded')
})

test('flagged usage response uses the billing-anniversary period and canonical ledger count', async (t) => {
  const previousFlag = process.env.RESUME_QUOTA_RESERVATIONS_ENABLED
  process.env.RESUME_QUOTA_RESERVATIONS_ENABLED = 'true'

  try {
    t.mock.method(pool, 'query', async (sql) => {
      if (sql.includes('FROM users')) {
        return {
          rows: [{
            id: 10,
            subscription_status: 'active',
            subscription_plan: 'annual',
            quota_anchor_at: '2026-01-20T08:30:00.000Z',
          }],
        }
      }
      if (sql.includes('FROM usage_overrides')) return { rows: [] }
      if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 123 }] }
      return { rows: [] }
    })

    const { response, payload } = await requestUsage({ headers: authHeader(10) })

    assert.equal(response.status, 200)
    assert.equal(payload.used, 123)
    assert.match(payload.periodStart, /-20T08:30:00\.000Z$/)
    assert.match(payload.periodEnd, /-20T08:30:00\.000Z$/)
    const now = Date.now()
    assert.ok(new Date(payload.periodStart).getTime() <= now)
    assert.ok(new Date(payload.periodEnd).getTime() > now)
  } finally {
    if (previousFlag === undefined) delete process.env.RESUME_QUOTA_RESERVATIONS_ENABLED
    else process.env.RESUME_QUOTA_RESERVATIONS_ENABLED = previousFlag
  }
})
