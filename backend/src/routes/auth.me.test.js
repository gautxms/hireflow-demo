import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import authRouter from './auth.js'
import { pool } from '../db/client.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  return app
}

function authHeader(user) {
  return {
    Authorization: `Bearer ${jwt.sign({ userId: user.id, user }, process.env.JWT_SECRET)}`,
  }
}

async function requestCurrentUser(headers) {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}/auth/me`, { headers })
    return { response, payload: await response.json() }
  } finally {
    server.close()
  }
}

function dbUser(status, hasHistoricalData) {
  return {
    id: 40,
    email: 'recruiter@example.com',
    company: 'HireFlow',
    phone: '',
    subscription_status: status,
    subscription_plan: null,
    current_period_end: null,
    next_billing_date: null,
    paddle_customer_id: null,
    paddle_subscription_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
    deleted_at: null,
    deletion_scheduled_for: null,
    hasHistoricalData,
  }
}

for (const status of ['past_due', 'payment_failed', 'paused', 'canceled', 'cancelled', 'inactive']) {
  test(`GET /auth/me returns authoritative history for ${status} access resolution`, async (t) => {
    process.env.JWT_SECRET = 'test-secret'
    const user = dbUser(status, true)
    let capturedSql = ''

    t.mock.method(pool, 'query', async (sql, params) => {
      capturedSql = sql
      assert.deepEqual(params, [40])
      return { rows: [user] }
    })

    const { response, payload } = await requestCurrentUser(authHeader(user))

    assert.equal(response.status, 200)
    assert.equal(payload.subscription_status, status)
    assert.equal(payload.hasHistoricalData, true)
    for (const table of ['job_descriptions', 'resumes', 'analyses', 'candidate_profiles', 'shortlists', 'report_definitions']) {
      assert.match(capturedSql, new RegExp(`EXISTS \\(SELECT 1 FROM ${table}`))
    }
  })
}

test('GET /auth/me returns false when the account has no historical workspace data', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const user = dbUser('inactive', false)

  t.mock.method(pool, 'query', async () => ({ rows: [user] }))

  const { response, payload } = await requestCurrentUser(authHeader(user))

  assert.equal(response.status, 200)
  assert.equal(payload.hasHistoricalData, false)
})
