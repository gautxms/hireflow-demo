import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMcpAnalysisStatus,
  getMcpResumeQuota,
  listMcpJobs,
} from './mcpHireFlowReadService.js'

test('listMcpJobs returns owner-scoped searchable job choices', async () => {
  const db = {
    async query(sql, params) {
      assert.match(String(sql), /status <> 'archived'/)
      assert.match(String(sql), /title ILIKE/)
      assert.deepEqual(params, [7, 'Engineer', 10])
      return {
        rows: [{
          id: 'job-1',
          title: 'Platform Engineer',
          status: 'active',
          department: 'Engineering',
          location: 'Remote',
          updated_at: '2026-10-28T00:00:00.000Z',
        }],
      }
    },
  }

  const result = await listMcpJobs({ db, userId: 7, query: 'Engineer', limit: 10 })
  assert.deepEqual(result.jobs, [{
    id: 'job-1',
    title: 'Platform Engineer',
    status: 'active',
    department: 'Engineering',
    location: 'Remote',
    updatedAt: '2026-10-28T00:00:00.000Z',
  }])
})

test('getMcpAnalysisStatus returns compact progress without candidate data', async () => {
  const db = {
    async query(sql, params) {
      assert.match(String(sql), /a\.id = \$1 AND a\.user_id = \$2/)
      assert.deepEqual(params, ['analysis-1', 7])
      return {
        rows: [{
          id: 'analysis-1',
          name: 'October batch',
          status: 'processing',
          job_description_id: 'job-1',
          job_description_title: 'Platform Engineer',
          total_count: 5,
          complete_count: 2,
          failed_count: 1,
          processing_count: 1,
          queued_count: 1,
          created_at: '2026-10-28T00:00:00.000Z',
          completed_at: null,
        }],
      }
    },
  }

  const result = await getMcpAnalysisStatus({ db, userId: 7, analysisId: 'analysis-1' })
  assert.deepEqual(result.counts, { total: 5, complete: 2, failed: 1, processing: 1, queued: 1 })
  assert.deepEqual(result.job, { id: 'job-1', title: 'Platform Engineer' })
  assert.equal(result.completedAt, null)
})

test('getMcpAnalysisStatus derives completion without requiring a web detail request', async () => {
  const db = {
    async query() {
      return {
        rows: [{
          id: 'analysis-complete',
          name: 'Finished batch',
          status: 'processing',
          job_description_id: null,
          total_count: 2,
          complete_count: 2,
          failed_count: 0,
          processing_count: 0,
          queued_count: 0,
          created_at: '2026-10-28T00:00:00.000Z',
          completed_at: null,
        }],
      }
    },
  }

  const result = await getMcpAnalysisStatus({
    db,
    userId: 7,
    analysisId: 'analysis-complete',
  })
  assert.equal(result.status, 'complete')
})

test('getMcpResumeQuota reports available units without reserving them', async () => {
  const queries = []
  const db = {
    async query(sql) {
      const text = String(sql)
      queries.push(text)
      if (text.includes('FROM users')) {
        return { rows: [{ subscription_status: 'active', subscription_plan: null }] }
      }
      if (text.includes('FROM usage_overrides')) return { rows: [] }
      if (text.includes('FROM usage_log')) return { rows: [{ usage_count: 12 }] }
      throw new Error(`Unexpected query: ${text}`)
    },
  }

  const result = await getMcpResumeQuota({
    db,
    userId: 7,
    env: {},
    now: new Date('2026-10-28T00:00:00.000Z'),
  })

  assert.equal(result.limit, 800)
  assert.equal(result.used, 12)
  assert.equal(result.available, 788)
  assert.equal(result.canCreateAnalysis, true)
  assert.equal(queries.some((sql) => /INSERT|UPDATE|DELETE/.test(sql)), false)
})
