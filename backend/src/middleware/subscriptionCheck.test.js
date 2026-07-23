import test from 'node:test'
import assert from 'node:assert/strict'
import { PAID_MONTHLY_RESUME_ANALYSIS_LIMIT, TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT } from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import {
  enforceUploadLimit,
  observeBillingPeriodQuota,
  requireActiveSubscription,
  trackUploadUsage,
} from './subscriptionCheck.js'

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    set(name, value) {
      this.headers[name] = value
      return this
    },
  }
}

test('requireActiveSubscription allows active subscribers', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({
    rows: [{
      id: 1,
      subscription_status: 'active',
      subscription_plan: 'annual',
      quota_anchor_at: '2026-01-20T08:30:00.000Z',
    }],
  })

  try {
    const req = { userId: 1 }
    const res = createRes()
    let nextCalled = false

    await requireActiveSubscription(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.subscriptionStatus, 'active')
    assert.equal(req.subscriptionStatusForQuota, 'active')
    assert.equal(req.rawSubscriptionStatus, 'active')
    assert.equal(req.hasActivePaidAccess, true)
    assert.equal(req.hasScheduledCancellationAccess, false)
    assert.deepEqual(req.subscriptionQuotaContext, {
      status: 'active',
      plan: 'annual',
      quotaAnchorAt: '2026-01-20T08:30:00.000Z',
    })
  } finally {
    pool.query = originalQuery
  }
})

test('billing-period quota observation compares counts without changing the legacy decision', async () => {
  const originalQuery = pool.query
  const originalFlag = process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE
  const queries = []
  process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE = 'true'
  pool.query = async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [{ usage_count: 801 }] }
  }

  try {
    const observation = await observeBillingPeriodQuota({
      userId: 1,
      subscriptionContext: {
        status: 'active',
        plan: 'annual',
        quotaAnchorAt: '2026-01-20T08:30:00.000Z',
      },
      legacyPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      legacyUsage: 799,
      uploadLimit: 800,
      requestedUploads: 1,
      referenceDate: new Date('2026-07-23T12:00:00.000Z'),
    })

    assert.equal(observation.mode, 'shadow')
    assert.equal(observation.legacyWouldBlock, false)
    assert.equal(observation.proposedWouldBlock, true)
    assert.equal(observation.decisionDiffers, true)
    assert.equal(observation.proposedUsage, 801)
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /created_at >= \$2/)
    assert.equal(queries[0].params[1].toISOString(), '2026-07-20T08:30:00.000Z')
    assert.equal(queries[0].params[2].toISOString(), '2026-08-20T08:30:00.000Z')
  } finally {
    pool.query = originalQuery
    if (originalFlag === undefined) delete process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE
    else process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE = originalFlag
  }
})

test('billing-period shadow failures never block legacy quota enforcement', async () => {
  const originalQuery = pool.query
  const originalFlag = process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE
  process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE = 'true'
  pool.query = async () => {
    throw Object.assign(new Error('shadow database failure'), { code: 'TEST_FAILURE' })
  }

  try {
    const observation = await observeBillingPeriodQuota({
      userId: 1,
      subscriptionContext: {
        status: 'active',
        plan: 'monthly',
        quotaAnchorAt: '2026-01-20T08:30:00.000Z',
      },
      legacyPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      legacyUsage: 10,
      uploadLimit: 800,
      requestedUploads: 1,
      referenceDate: new Date('2026-07-23T12:00:00.000Z'),
    })

    assert.equal(observation.comparisonFailed, true)
    assert.equal(observation.legacyUsage, 10)
  } finally {
    pool.query = originalQuery
    if (originalFlag === undefined) delete process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE
    else process.env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE = originalFlag
  }
})

test('requireActiveSubscription preserves trialing status for trial quota', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'trialing' }] })

  try {
    const req = { userId: 1 }
    const res = createRes()
    let nextCalled = false

    await requireActiveSubscription(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.subscriptionStatus, 'trialing')
    assert.equal(req.subscriptionStatusForQuota, 'trialing')
    assert.equal(req.rawSubscriptionStatus, 'trialing')
    assert.equal(req.hasActivePaidAccess, true)
    assert.equal(req.hasScheduledCancellationAccess, false)
  } finally {
    pool.query = originalQuery
  }
})

test('requireActiveSubscription blocks inactive subscribers', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'inactive' }] })

  try {
    const req = { userId: 1 }
    const res = createRes()

    await requireActiveSubscription(req, res, () => {})

    assert.equal(res.statusCode, 403)
    assert.equal(res.body.error, 'Subscription inactive')
  } finally {
    pool.query = originalQuery
  }
})

test('requireActiveSubscription blocks Paddle failed payment states', async () => {
  const originalQuery = pool.query

  try {
    for (const status of ['past_due', 'payment_failed', 'paused']) {
      pool.query = async () => ({ rows: [{ id: 1, subscription_status: status }] })
      const req = { userId: 1 }
      const res = createRes()
      let nextCalled = false

      await requireActiveSubscription(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 403)
      assert.equal(res.body.error, 'Subscription inactive')
    }
  } finally {
    pool.query = originalQuery
  }
})

test('requireActiveSubscription allows scheduled cancellation before effective date', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'cancelled', cancellation_effective_at: '2099-01-01T00:00:00Z' }] })

  try {
    const req = { userId: 1 }
    const res = createRes()
    let nextCalled = false

    await requireActiveSubscription(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.subscriptionStatus, 'active')
    assert.equal(req.subscriptionStatusForQuota, 'active')
    assert.equal(req.rawSubscriptionStatus, 'cancelled')
    assert.equal(req.hasActivePaidAccess, true)
    assert.equal(req.hasScheduledCancellationAccess, true)
  } finally {
    pool.query = originalQuery
  }
})

test('requireActiveSubscription blocks final cancellation despite a stale future current period', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({
    rows: [{
      id: 1,
      subscription_status: 'cancelled',
      cancellation_effective_at: '2025-01-01T00:00:00Z',
      current_period_end: '2099-01-01T00:00:00Z',
    }],
  })

  try {
    const req = { userId: 1 }
    const res = createRes()
    let nextCalled = false

    await requireActiveSubscription(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.error, 'Subscription inactive')
  } finally {
    pool.query = originalQuery
  }
})

test('requireActiveSubscription fails closed for terminal cancellation missing its effective date', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({
    rows: [{
      id: 1,
      subscription_status: 'canceled',
      current_period_end: '2099-01-01T00:00:00Z',
    }],
  })

  try {
    const req = { userId: 1 }
    const res = createRes()
    let nextCalled = false

    await requireActiveSubscription(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.error, 'Subscription inactive')
  } finally {
    pool.query = originalQuery
  }
})

test('requireActiveSubscription paid mutation matrix preserves blocked and allowed subscription states', async () => {
  const originalQuery = pool.query

  try {
    const blockedCases = [
      { subscription_status: 'past_due' },
      { subscription_status: 'payment_failed' },
      { subscription_status: 'inactive' },
      { subscription_status: 'canceled', cancellation_effective_at: '2025-01-01T00:00:00Z' },
      { subscription_status: 'cancelled', cancellation_effective_at: '2025-01-01T00:00:00Z' },
      { subscription_status: 'unknown' },
      { subscription_status: null },
    ]

    for (const user of blockedCases) {
      pool.query = async () => ({ rows: [{ id: 1, ...user }] })
      const req = { userId: 1 }
      const res = createRes()
      let nextCalled = false

      await requireActiveSubscription(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false, `${user.subscription_status} should not call next`)
      assert.equal(res.statusCode, 403, `${user.subscription_status} should be blocked`)
      assert.equal(res.body.error, 'Subscription inactive')
    }

    const allowedCases = [
      { subscription_status: 'active', expectedStatus: 'active' },
      { subscription_status: 'trialing', expectedStatus: 'trialing' },
      { subscription_status: 'trial', expectedStatus: 'trial' },
      { subscription_status: 'cancelled', cancellation_effective_at: '2099-01-01T00:00:00Z', expectedStatus: 'active' },
    ]

    for (const user of allowedCases) {
      pool.query = async () => ({ rows: [{ id: 1, ...user }] })
      const req = { userId: 1 }
      const res = createRes()
      let nextCalled = false

      await requireActiveSubscription(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, true, `${user.subscription_status} should call next`)
      assert.equal(req.subscriptionStatusForQuota, user.expectedStatus)
      assert.equal(req.hasActivePaidAccess, true)
    }
  } finally {
    pool.query = originalQuery
  }
})

test('enforceUploadLimit allows active paid users through the advertised 800-resume allowance', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: PAID_MONTHLY_RESUME_ANALYSIS_LIMIT - 1 }] }
    throw new Error(`Unexpected query: ${sql}`)
  }

  try {
    const req = {
      userId: 1,
      subscriptionStatus: 'active',
      ip: '127.0.0.1',
      headers: {},
      files: [{ originalname: 'resume.pdf' }],
    }
    const res = createRes()
    let nextCalled = false

    await enforceUploadLimit(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.usageContext.uploadLimit, PAID_MONTHLY_RESUME_ANALYSIS_LIMIT)
    assert.equal(req.usageContext.currentUsage, PAID_MONTHLY_RESUME_ANALYSIS_LIMIT - 1)
    assert.equal(req.usageContext.requestedUploads, 1)
    assert.equal(req.usageContext.remainingUploads, 1)
  } finally {
    pool.query = originalQuery
  }
})

test('enforceUploadLimit keeps trialing users on the trial resume allowance', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT }] }
    throw new Error(`Unexpected query: ${sql}`)
  }

  try {
    const req = {
      userId: 1,
      subscriptionStatus: 'trialing',
      subscriptionStatusForQuota: 'trialing',
      ip: '127.0.0.1',
      headers: {},
      files: [{ originalname: 'resume.pdf' }],
    }
    const res = createRes()
    let nextCalled = false

    await enforceUploadLimit(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 429)
    assert.equal(res.body.limit, TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT)
    assert.equal(res.body.used, TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT)
  } finally {
    pool.query = originalQuery
  }
})

test('enforceUploadLimit gives scheduled-cancellation users the paid resume allowance', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: PAID_MONTHLY_RESUME_ANALYSIS_LIMIT - 1 }] }
    throw new Error(`Unexpected query: ${sql}`)
  }

  try {
    const req = {
      userId: 1,
      subscriptionStatus: 'active',
      subscriptionStatusForQuota: 'active',
      rawSubscriptionStatus: 'cancelled',
      hasScheduledCancellationAccess: true,
      ip: '127.0.0.1',
      headers: {},
      files: [{ originalname: 'resume.pdf' }],
    }
    const res = createRes()
    let nextCalled = false

    await enforceUploadLimit(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.usageContext.uploadLimit, PAID_MONTHLY_RESUME_ANALYSIS_LIMIT)
    assert.equal(req.usageContext.remainingUploads, 1)
  } finally {
    pool.query = originalQuery
  }
})

test('enforceUploadLimit counts every resume in a batch before accepting the upload', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: PAID_MONTHLY_RESUME_ANALYSIS_LIMIT - 1 }] }
    throw new Error(`Unexpected query: ${sql}`)
  }

  try {
    const req = {
      userId: 1,
      subscriptionStatus: 'active',
      ip: '127.0.0.1',
      headers: {},
      files: [{ originalname: 'one.pdf' }, { originalname: 'two.pdf' }],
    }
    const res = createRes()
    let nextCalled = false

    await enforceUploadLimit(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 429)
    assert.equal(res.body.limit, PAID_MONTHLY_RESUME_ANALYSIS_LIMIT)
    assert.equal(res.body.used, PAID_MONTHLY_RESUME_ANALYSIS_LIMIT - 1)
    assert.equal(res.body.requested, 2)
    assert.equal(res.body.remaining, 1)
  } finally {
    pool.query = originalQuery
  }
})

test('enforceUploadLimit honors admin overrides when checking batch usage', async () => {
  const originalQuery = pool.query
  const queries = []
  pool.query = async (sql, params) => {
    queries.push({ sql, params })
    if (sql.includes('FROM usage_overrides')) {
      return { rows: [{ upload_limit: 2, reset_usage: false }] }
    }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 1 }] }
    throw new Error(`Unexpected query: ${sql}`)
  }

  try {
    const req = {
      userId: 1,
      subscriptionStatus: 'active',
      ip: '127.0.0.1',
      headers: {},
      files: [{ originalname: 'one.pdf' }, { originalname: 'two.pdf' }],
    }
    const res = createRes()
    let nextCalled = false

    await enforceUploadLimit(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 429)
    assert.equal(res.body.limit, 2)
    assert.equal(res.body.used, 1)
    assert.equal(res.body.requested, 2)
    assert.equal(res.body.remaining, 1)
    assert.equal(queries.find((query) => query.sql.includes('FROM usage_log')).params.length, 2)
  } finally {
    pool.query = originalQuery
  }
})

test('trackUploadUsage writes one usage row per resume in the accepted batch', async () => {
  const originalQuery = pool.query
  const queries = []
  pool.query = async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [] }
  }

  try {
    const req = {
      userId: 1,
      usageContext: {
        monthStart: new Date(Date.UTC(2026, 4, 1)),
        ipAddress: '127.0.0.1',
        requestedUploads: 3,
      },
    }
    let nextCalled = false

    await trackUploadUsage(req, createRes(), () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /generate_series\(1, \$4\)/)
    assert.deepEqual(queries[0].params.slice(0, 2), [1, '127.0.0.1'])
    assert.equal(queries[0].params[3], 3)
  } finally {
    pool.query = originalQuery
  }
})

test('trackUploadUsage skips counting when quota context is absent', async () => {
  const originalQuery = pool.query
  const queries = []
  pool.query = async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [] }
  }

  try {
    let nextCalled = false

    await trackUploadUsage({ userId: 1 }, createRes(), () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(queries.length, 0)
  } finally {
    pool.query = originalQuery
  }
})
