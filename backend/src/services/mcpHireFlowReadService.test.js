import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMcpAnalysisResults,
  getMcpAnalysisStatus,
  getMcpResumeQuota,
  listMcpJobs,
  normalizeMcpCandidateResult,
} from './mcpHireFlowReadService.js'

function createAnalysisReadDb({ analysis, items = [], uploads = [] }) {
  return {
    async query(sql, params) {
      const text = String(sql)
      if (text.includes('FROM analyses a')) {
        assert.match(text, /a\.id = \$1 AND a\.user_id = \$2/)
        return { rows: analysis ? [analysis] : [] }
      }
      if (text.includes('FROM upload_chunks uc')) return { rows: uploads }
      if (text.includes('FROM analysis_items ai')) return { rows: items }
      if (text.includes('UPDATE analyses')) return { rows: [] }
      throw new Error(`Unexpected query: ${text} | ${JSON.stringify(params)}`)
    },
  }
}

test('getMcpAnalysisResults returns owner-scoped authoritative HireFlow candidate results', async () => {
  const db = createAnalysisReadDb({
    analysis: {
      id: 'analysis-1',
      user_id: 7,
      name: 'October batch',
      status: 'failed',
      job_description_id: 'job-1',
      job_description_title: 'Customer Success Manager',
      created_at: '2026-10-28T00:00:00.000Z',
      completed_at: '2026-10-28T00:01:00.000Z',
    },
    items: [
      {
        id: 'item-1',
        resume_id: 'resume-1',
        filename: 'stored.pdf',
        original_filename: 'Alice Resume.pdf',
        parse_job_status: 'complete',
        progress: 100,
        parse_result: {
                candidates: [{
                  id: 'candidate-1',
                  name: 'Alice Candidate',
                  email: 'alice@example.com',
                  location: 'Mumbai',
                  years_experience: 6,
                  seniority_level: 'Senior',
                  education: [{ degree: 'BBA', school: 'Mumbai University' }],
                  score: 82,
                  verdict: 'strong_match',
                  summaryFull: 'Strong customer-success experience with quantified retention outcomes.',
                  recommendationFull: 'Proceed to interview.',
                  strengths: ['SaaS renewals', 'Executive stakeholder management'],
                  considerations: ['Confirm enterprise portfolio size'],
                  skills: ['Gainsight', 'Salesforce'],
                  matchScore: {
                    score: 82,
                    score_out_of_ten: 8.2,
                    reason: 'Strong evidence against the core requirements.',
                    breakdown: { skills_match: '84%', experience_match_score: '77/100' },
                  },
                  fit_assessment: {
                    confidence_score: 0.9,
                    matched_requirements: ['SaaS customer success'],
                    missing_requirements: ['No explicit APAC portfolio evidence'],
                    risks_or_gaps: ['Enterprise book size is unclear'],
                  },
                }],
        },
      },
      {
        id: 'item-2',
        resume_id: 'resume-2',
        filename: 'broken.doc',
        original_filename: null,
        parse_job_status: 'failed',
        progress: 100,
        error_message: 'provider failure',
        parse_result: null,
      },
    ],
  })

  const result = await getMcpAnalysisResults({ db, userId: 7, analysisId: 'analysis-1', queue: null })
  assert.equal(result.analysisId, 'analysis-1')
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.job, { id: 'job-1', title: 'Customer Success Manager' })
  assert.equal(result.candidates.length, 1)
  assert.deepEqual(result.candidates[0], {
    id: 'candidate-1',
    resumeId: 'resume-1',
    filename: 'Alice Resume.pdf',
    name: 'Alice Candidate',
    email: 'alice@example.com',
    phone: null,
    title: null,
    location: 'Mumbai',
    yearsExperience: 6,
    seniorityLevel: 'Senior',
    education: 'BBA — Mumbai University',
    score: 82,
    scoreOutOfTen: 8.2,
    verdict: 'strong_match',
    confidenceLabel: 'High confidence',
    summary: 'Strong customer-success experience with quantified retention outcomes.',
    reason: 'Strong evidence against the core requirements.',
    recommendation: 'Proceed to interview.',
    strengths: ['SaaS renewals', 'Executive stakeholder management'],
    considerations: ['Enterprise book size is unclear'],
    matchedRequirements: ['SaaS customer success'],
    missingRequirements: ['No explicit APAC portfolio evidence'],
    risksOrGaps: ['Enterprise book size is unclear'],
    skills: ['Gainsight', 'Salesforce'],
    experienceHighlights: [],
    breakdown: [
      { key: 'skills_match', label: 'Skills match', value: 84 },
      { key: 'relevant_experience', label: 'Relevant experience', value: 77 },
    ],
    analysisMode: null,
  })
  assert.deepEqual(result.failures, [{ filename: 'broken.doc', reason: 'HireFlow could not analyse this resume.' }])
})

test('MCP candidate details use the same numeric breakdown and recommendation rules as HireFlow', () => {
  const qualitative = normalizeMcpCandidateResult({
    name: 'Qualitative Candidate',
    score: 72,
    matchScore: {
      reason: 'Relevant background but limited ownership evidence.',
      breakdown: { skills_match: 'Strong', experience_match_score: 'Meets requirement' },
    },
    fit_assessment: { confidence_score: null },
  }, { resumeId: 'resume-qualitative' })
  assert.deepEqual(qualitative.breakdown, [])
  assert.equal(qualitative.recommendation, null)
  assert.equal(qualitative.confidenceLabel, null)

  const numeric = normalizeMcpCandidateResult({
    name: 'Numeric Candidate',
    score: 88,
    ai_scoring_contract_v2: {
      skills_match_score: 0.91,
      relevant_experience_score: '86%',
      education_relevance_score: '75/100',
      seniority_progression_score: 68,
    },
  }, { resumeId: 'resume-numeric' })
  assert.deepEqual(numeric.breakdown, [
    { key: 'skills_match', label: 'Skills match', value: 91 },
    { key: 'relevant_experience', label: 'Relevant experience', value: 86 },
    { key: 'education_relevance', label: 'Education relevance', value: 75 },
    { key: 'seniority_progression', label: 'Seniority / progression', value: 68 },
  ])
})

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
  const statuses = ['complete', 'complete', 'failed', 'processing', 'queued']
  const db = createAnalysisReadDb({
    analysis: {
      id: 'analysis-1',
      user_id: 7,
      name: 'October batch',
      status: 'processing',
      job_description_id: 'job-1',
      job_description_title: 'Platform Engineer',
      created_at: '2026-10-28T00:00:00.000Z',
      completed_at: null,
    },
    items: statuses.map((status, index) => ({
      id: `item-${index}`,
      resume_id: `resume-${index}`,
      filename: `${index}.pdf`,
      parse_job_status: status,
      progress: status === 'complete' || status === 'failed' ? 100 : 25,
      parse_result: status === 'complete' ? { candidates: [] } : null,
    })),
  })

  const result = await getMcpAnalysisStatus({ db, userId: 7, analysisId: 'analysis-1', queue: null })
  assert.deepEqual(result.counts, { total: 5, complete: 2, failed: 1, processing: 1, queued: 1 })
  assert.deepEqual(result.job, { id: 'job-1', title: 'Platform Engineer' })
  assert.equal(result.completedAt, null)
})

test('getMcpAnalysisStatus derives completion without requiring a web detail request', async () => {
  const db = createAnalysisReadDb({
    analysis: {
      id: 'analysis-complete',
      user_id: 7,
      name: 'Finished batch',
      status: 'complete',
      job_description_id: null,
      created_at: '2026-10-28T00:00:00.000Z',
      completed_at: '2026-10-28T00:01:00.000Z',
    },
    items: [1, 2].map((index) => ({
      id: `item-${index}`,
      resume_id: `resume-${index}`,
      filename: `${index}.pdf`,
      parse_job_status: 'complete',
      progress: 100,
      parse_result: { candidates: [] },
    })),
  })

  const result = await getMcpAnalysisStatus({
    db,
    userId: 7,
    analysisId: 'analysis-complete',
    queue: null,
  })
  assert.equal(result.status, 'complete')
})

test('getMcpAnalysisStatus includes unmatched failed web uploads', async () => {
  const db = createAnalysisReadDb({
    analysis: {
      id: 'analysis-partial',
      user_id: 7,
      name: 'Mixed web batch',
      status: 'failed',
      job_description_id: null,
      created_at: '2026-10-28T00:00:00.000Z',
      completed_at: '2026-10-28T00:01:00.000Z',
    },
    items: [{
      id: 'item-complete',
      resume_id: 'resume-complete',
      filename: 'complete.pdf',
      parse_job_status: 'complete',
      progress: 100,
      parse_result: { candidates: [] },
    }],
    uploads: [{
      upload_id: 'upload-failed',
      filename: 'failed.pdf',
      mime_type: 'application/pdf',
      status: 'rejected',
      updated_at: '2026-10-28T00:00:00.000Z',
    }],
  })

  const result = await getMcpAnalysisStatus({
    db,
    userId: 7,
    analysisId: 'analysis-partial',
    queue: null,
  })
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.counts, {
    total: 2,
    complete: 1,
    failed: 1,
    processing: 0,
    queued: 0,
  })
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
