import test from 'node:test'
import assert from 'node:assert/strict'
import { PAID_MONTHLY_RESUME_ANALYSIS_LIMIT, TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT } from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import { enforceUploadLimit, requireActiveSubscription, trackUploadUsage } from './subscriptionCheck.js'

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
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'active' }] })

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
  } finally {
    pool.query = originalQuery
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

test('requireActiveSubscription blocks expired canceled subscribers from paid mutations', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'cancelled', cancellation_effective_at: '2025-01-01T00:00:00Z' }] })

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
