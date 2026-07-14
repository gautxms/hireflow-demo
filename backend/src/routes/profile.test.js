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
    hasHistoricalData: true,
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
  assert.equal(payload.user.hasHistoricalData, true)
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /FROM users\s+WHERE id = \$1/)
  for (const table of ['job_descriptions', 'resumes', 'analyses', 'candidate_profiles', 'shortlists', 'report_definitions']) {
    assert.match(queries[0].sql, new RegExp(`EXISTS \\(SELECT 1 FROM ${table}`))
  }
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

function buildExportRowsForUser(status = 'active') {
  return {
    users: [activeDbUser({ subscription_status: status, subscription_plan: status === 'inactive' ? null : 'monthly' })],
    job_descriptions: [{ id: 'job-user', title: 'Engineer', status: 'active', description: 'Build things' }],
    resumes: [{ id: 'resume-user', filename: 'alice.pdf', original_filename: 'Alice Resume.pdf', created_at: '2026-07-02T00:00:00.000Z' }],
    analyses: [{ id: 'analysis-user', name: 'July analysis', job_description_id: 'job-user', status: 'complete', resume_count: 1 }],
    analysis_items: [{ id: 'item-user', analysis_id: 'analysis-user', resume_id: 'resume-user', status: 'complete', stored_result: { candidates: [{ name: 'Alice', score: 91 }] } }],
    candidate_profiles: [{ id: 'candidate-user', resume_id: 'resume-user', stored_candidate_result: { name: 'Alice', score: 91, reasoning: 'stored text' } }],
    shortlists: [{ id: 'shortlist-user', name: 'Top candidates', status: 'active' }],
    shortlist_candidates: [{ id: 'shortlisted-user', shortlist_id: 'shortlist-user', resume_id: 'resume-user', analysis_id: 'analysis-user' }],
    subscriptions: status === 'none' ? [] : [{ id: 'sub-user', paddle_subscription_id: 'sub_public', status, latest_event_type: 'subscription.updated' }],
    billing_invoices: [{ id: 'invoice-user', invoice_number: 'INV-1', amount_cents: 1200, currency: 'USD', status: 'paid' }],
  }
}

function mockProfileExportQueries(t, rowsByTable) {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    assert.deepEqual(params, [40])

    if (/FROM users/.test(sql)) return { rows: rowsByTable.users || [] }
    if (/FROM job_descriptions/.test(sql)) return { rows: rowsByTable.job_descriptions || [] }
    if (/FROM resumes/.test(sql)) return { rows: rowsByTable.resumes || [] }
    if (/FROM analyses a/.test(sql)) return { rows: rowsByTable.analyses || [] }
    if (/FROM analysis_items ai/.test(sql)) return { rows: rowsByTable.analysis_items || [] }
    if (/FROM candidate_profiles cp/.test(sql)) return { rows: rowsByTable.candidate_profiles || [] }
    if (/FROM shortlists/.test(sql)) return { rows: rowsByTable.shortlists || [] }
    if (/FROM shortlist_candidates sc/.test(sql)) return { rows: rowsByTable.shortlist_candidates || [] }
    if (/FROM subscriptions/.test(sql)) return { rows: rowsByTable.subscriptions || [] }
    if (/FROM billing_invoices/.test(sql)) return { rows: rowsByTable.billing_invoices || [] }

    throw new Error(`Unexpected export query: ${sql}`)
  })
  return queries
}

for (const status of ['active', 'trialing', 'past_due', 'payment_failed', 'canceled', 'cancelled', 'inactive', 'none']) {
  test(`GET /profile/export returns 200 for ${status} users`, async (t) => {
    process.env.JWT_SECRET = 'test-secret'
    mockProfileExportQueries(t, buildExportRowsForUser(status))

    const { response, payload } = await requestProfile('/profile/export', {
      headers: authHeaderWithEmbeddedUser(activeDbUser({ subscription_status: status === 'none' ? 'inactive' : status })),
    })

    assert.equal(response.status, 200)
    assert.equal(payload.export_version, '2026-07-workspace-snapshot-v1')
    assert.equal(payload.data.user.id, 40)
    assert.ok(Array.isArray(payload.data.subscriptions))
  })
}

test('GET /profile/export returns complete workspace snapshot shape and preserves legacy sections', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  mockProfileExportQueries(t, buildExportRowsForUser('active'))

  const { response, payload } = await requestProfile('/profile/export', {
    headers: authHeaderWithEmbeddedUser(activeDbUser()),
  })

  assert.equal(response.status, 200)
  assert.match(payload.exported_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(Object.keys(payload.data), [
    'user',
    'subscription_summary',
    'jobs',
    'resumes',
    'analyses',
    'analysis_items',
    'candidate_results',
    'shortlists',
    'shortlisted_candidates',
    'subscriptions',
    'billing_invoices',
  ])
  assert.equal(payload.data.resumes[0].id, 'resume-user')
  assert.equal(payload.data.subscriptions[0].id, 'sub-user')
  assert.equal(payload.data.candidate_results[0].stored_candidate_result.reasoning, 'stored text')
})


test('GET /profile/export keeps resume SELECT compatible with checked migrations without resumes.updated_at', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queries = mockProfileExportQueries(t, buildExportRowsForUser('active'))

  const { response, payload } = await requestProfile('/profile/export', {
    headers: authHeaderWithEmbeddedUser(activeDbUser()),
  })

  assert.equal(response.status, 200)
  const resumeQuery = queries.find((query) => /FROM resumes\s+WHERE user_id = \$1/.test(query.sql))
  assert.ok(resumeQuery)
  const resumeSelectList = resumeQuery.sql.split('FROM resumes')[0]
  assert.doesNotMatch(resumeSelectList, /\bupdated_at\b/)
  assert.equal(payload.data.resumes[0].created_at, '2026-07-02T00:00:00.000Z')
  assert.equal(Object.hasOwn(payload.data.resumes[0], 'updated_at'), false)
})

test('GET /profile/export returns empty arrays for an empty workspace', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  mockProfileExportQueries(t, { users: [activeDbUser({ subscription_status: 'inactive', subscription_plan: null })] })

  const { response, payload } = await requestProfile('/profile/export', {
    headers: authHeaderWithEmbeddedUser(activeDbUser({ subscription_status: 'inactive' })),
  })

  assert.equal(response.status, 200)
  for (const key of ['jobs', 'resumes', 'analyses', 'analysis_items', 'candidate_results', 'shortlists', 'shortlisted_candidates', 'subscriptions', 'billing_invoices']) {
    assert.deepEqual(payload.data[key], [])
  }
})

test('GET /profile/export scopes every workspace query to authenticated user and safe joins', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queries = mockProfileExportQueries(t, buildExportRowsForUser('active'))

  const { response, payload } = await requestProfile('/profile/export', {
    headers: authHeaderWithEmbeddedUser(activeDbUser()),
  })

  assert.equal(response.status, 200)
  assert.equal(payload.data.jobs.some((job) => job.id === 'job-other'), false)
  assert.equal(payload.data.resumes.some((resume) => resume.id === 'resume-other'), false)
  assert.equal(payload.data.analyses.some((analysis) => analysis.id === 'analysis-other'), false)
  assert.equal(payload.data.analysis_items.some((item) => item.id === 'item-other'), false)
  assert.equal(payload.data.candidate_results.some((candidate) => candidate.id === 'candidate-other'), false)
  assert.equal(payload.data.shortlists.some((shortlist) => shortlist.id === 'shortlist-other'), false)
  assert.match(queries.find((query) => /FROM analysis_items ai/.test(query.sql)).sql, /INNER JOIN analyses a ON a\.id = ai\.analysis_id AND a\.user_id = \$1/)
  assert.match(queries.find((query) => /FROM shortlist_candidates sc/.test(query.sql)).sql, /INNER JOIN shortlists s ON s\.id = sc\.shortlist_id AND s\.user_id = \$1/)
})

test('GET /profile/export does not select sensitive auth or payment fields', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queries = mockProfileExportQueries(t, buildExportRowsForUser('active'))

  const { response, payload } = await requestProfile('/profile/export', {
    headers: authHeaderWithEmbeddedUser(activeDbUser()),
  })

  assert.equal(response.status, 200)
  const serializedPayload = JSON.stringify(payload)
  assert.equal(serializedPayload.includes('password_hash'), false)
  assert.equal(serializedPayload.includes('email_verification_token'), false)
  assert.equal(serializedPayload.includes('latest_event_payload'), false)
  assert.equal(serializedPayload.includes('payload'), false)
  for (const { sql } of queries) {
    assert.doesNotMatch(sql, /password_hash|email_verification_token|reset_token|latest_event_payload|payload|secret|api_key/i)
  }
})

test('GET /profile/export exports older partial analysis records without crashing', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const rows = buildExportRowsForUser('active')
  rows.analyses = [{ id: 'analysis-partial', name: null, job_description_id: null, status: 'partial', error_summary: 'Some resumes failed' }]
  rows.analysis_items = [{ id: 'item-partial', analysis_id: 'analysis-partial', resume_id: 'resume-user', status: 'failed', stored_result: null }]
  rows.candidate_profiles = []
  mockProfileExportQueries(t, rows)

  const { response, payload } = await requestProfile('/profile/export', {
    headers: authHeaderWithEmbeddedUser(activeDbUser()),
  })

  assert.equal(response.status, 200)
  assert.equal(payload.data.analyses[0].id, 'analysis-partial')
  assert.equal(payload.data.analysis_items[0].stored_result, null)
})
