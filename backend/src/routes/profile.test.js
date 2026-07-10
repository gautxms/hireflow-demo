import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import profileRouter, { formatRate, resolveDashboardDateRange } from './profile.js'
import { pool } from '../db/client.js'
import { resolveSubscriptionState } from '../../../src/utils/subscriptionState.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/profile', profileRouter)
  return app
}

function authHeaderWithEmbeddedUser(user) {
  return {
    Authorization: `Bearer ${jwt.sign({ userId: user.id, user }, process.env.JWT_SECRET)}`,
  }
}

async function requestProfile(path, { method = 'GET', headers, body } = {}) {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json()
    return { response, payload }
  } finally {
    server.close()
  }
}

function activeDbUser(overrides = {}) {
  return {
    id: 40,
    email: 'active@example.com',
    company: 'HireFlow',
    phone: '+14155552671',
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_customer_id: 'ctm_123',
    paddle_subscription_id: 'sub_123',
    current_period_end: '2026-08-01T00:00:00.000Z',
    next_billing_date: '2026-08-01T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    deleted_at: null,
    deletion_scheduled_for: null,
    ...overrides,
  }
}

test('resolveDashboardDateRange defaults to last 30 days', () => {
  const now = new Date('2026-04-26T12:00:00.000Z')
  const result = resolveDashboardDateRange({}, now)

  assert.equal(result.startDate.toISOString().slice(0, 10), '2026-03-28')
  assert.equal(result.endDate.toISOString().slice(0, 10), '2026-04-26')
  assert.equal(result.effectiveRangeDays, 30)
})

test('resolveDashboardDateRange rejects ranges above max', () => {
  assert.throws(
    () => resolveDashboardDateRange({ startDate: '2025-01-01', endDate: '2026-04-26' }),
    /Date range cannot exceed 180 days/,
  )
})

test('formatRate returns 0 for zero or null denominators', () => {
  assert.equal(formatRate(10, 0), 0)
  assert.equal(formatRate(10, null), 0)
  assert.equal(formatRate(10, undefined), 0)
})

test('formatRate returns 0 for null numerators and caps rates at 100%', () => {
  assert.equal(formatRate(null, 5), 0)
  assert.equal(formatRate(undefined, 5), 0)
  assert.equal(formatRate(7, 5), 100)
})

test('GET /profile/me returns fresh subscription fields from database despite stale embedded token user', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const staleTokenUser = activeDbUser({ subscription_status: 'inactive', subscription_plan: null })
  const queries = []

  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    assert.equal(params[0], 40)
    return { rows: [activeDbUser()] }
  })

  const { response, payload } = await requestProfile('/profile/me', {
    headers: authHeaderWithEmbeddedUser(staleTokenUser),
  })

  assert.equal(response.status, 200)
  assert.equal(payload.user.id, 40)
  assert.equal(payload.user.subscription_status, 'active')
  assert.equal(payload.user.subscription_plan, 'monthly')
  assert.equal(payload.user.paddle_customer_id, 'ctm_123')
  assert.equal(payload.user.paddle_subscription_id, 'sub_123')
  assert.equal(payload.user.current_period_end, '2026-08-01T00:00:00.000Z')
  assert.equal(payload.user.next_billing_date, '2026-08-01T00:00:00.000Z')
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /FROM users\s+WHERE id = \$1/)
})

test('Account settings subscription state treats fresh active /profile/me user as billing-manageable', () => {
  const subscriptionState = resolveSubscriptionState({ user: activeDbUser() })
  const billingPrimaryHref = subscriptionState.isFree ? '/pricing' : '/billing'
  const helperCopy = subscriptionState.isFree ? 'Pricing' : 'Billing & Plans'

  assert.equal(subscriptionState.rawStatus, 'active')
  assert.equal(subscriptionState.isFree, false)
  assert.equal(billingPrimaryHref, '/billing')
  assert.equal(helperCopy, 'Billing & Plans')
})

test('PATCH /profile/me keeps editable fields behavior and returns fresh account profile', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const staleTokenUser = activeDbUser({ company: 'Old Co', phone: '', subscription_status: 'inactive' })
  const queries = []

  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    if (/UPDATE users/.test(sql)) {
      assert.deepEqual(params, ['New Co', '+14155550000', 40])
      assert.match(sql, /SET company = \$1, phone = \$2/)
      assert.match(sql, /WHERE id = \$3/)
      return { rows: [], rowCount: 1 }
    }

    assert.match(sql, /SELECT id, email, company, phone, subscription_status, subscription_plan/)
    return { rows: [activeDbUser({ company: 'New Co', phone: '+14155550000' })] }
  })

  const { response, payload } = await requestProfile('/profile/me', {
    method: 'PATCH',
    headers: authHeaderWithEmbeddedUser(staleTokenUser),
    body: { company: 'New Co', phone: '+14155550000' },
  })

  assert.equal(response.status, 200)
  assert.equal(payload.message, 'Profile updated successfully')
  assert.equal(payload.user.company, 'New Co')
  assert.equal(payload.user.phone, '+14155550000')
  assert.equal(payload.user.subscription_status, 'active')
  assert.equal(queries.length, 2)
})
