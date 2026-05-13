import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import candidatesRouter from './candidates.js'
import { pool } from '../db/client.js'
import { once } from 'node:events'

function buildApp() {
  const app = express()
  app.use('/candidates', candidatesRouter)
  return app
}

function authHeader(userId) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}


const REQUIRED_RESPONSE_KEYS = [
  'candidates',
  'totalCount',
  'page',
  'pageSize',
  'totalPages',
  'sortBy',
  'sortDirection',
]

const EXPECTED_KEYS = [
  'resumeId',
  'candidateId',
  'profile',
  'name',
  'email',
  'resumeFilename',
  'latestJobTitle',
  'skills',
  'profileScore',
  'recruiter',
  'yearsExperience',
  'topSkills',
  'tags',
  'parseStatus',
  'analysisStatus',
  'sourceParseJobId',
  'sourceUpdatedAt',
  'latestAnalysis',
  'dataCompleteness',
  'associatedJob',
]

test('GET /candidates/directory contract: modern + legacy + null-safe mixed dataset and filters', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  let shouldFailSync = false

  const modernResumeId = '11111111-1111-1111-1111-111111111111'
  const legacyResumeId = '22222222-2222-2222-2222-222222222222'
  const mixedResumeId = '33333333-3333-3333-3333-333333333333'

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM resumes r')) {
      if (shouldFailSync) throw new Error('sync timed out')
      return { rows: [] }
    }

    if (sql.includes('FROM candidate_profiles cp')) {
      if (sql.includes('skill_value = ANY') && sql.includes('>= $')) {
        return { rows: [] }
      }
      if (shouldFailSync) {
        return {
          rows: [
            {
              resume_id: '44444444-4444-4444-4444-444444444444',
              profile: { name: null, skills: null, top_skills: null, years_experience: null, profile_score: null },
              source_parse_job_id: null,
              source_updated_at: null,
              updated_at: null,
              filename: 'historical-import.pdf',
              profile_score: null,
              years_experience: null,
              job_description_id: null,
              parse_status: null,
              job_title: null,
              latest_analysis_id: null,
              latest_analysis_name: null,
              latest_analysis_created_at: null,
              latest_analysis_completed_at: null,
              latest_analysis_status: null,
              tags: null,
              total_count: 1,
            },
          ],
        }
      }

      return {
        rows: [
          {
            resume_id: modernResumeId,
            profile: {
              name: 'Modern Candidate',
              email: 'modern@example.com',
              years_experience: 6,
              profile_score: 92,
              top_skills: ['TypeScript', 'GraphQL', 'Kubernetes', 'Node.js', 'AWS'],
              skills: {
                tools_and_platforms: ['TypeScript', 'Node.js', 'AWS'],
                methodologies: ['TDD'],
                domain_expertise: ['FinTech'],
                soft_skills: ['Communication'],
              },
            },
            source_parse_job_id: 'analysis-modern',
            source_updated_at: '2026-05-10T00:00:00.000Z',
            updated_at: '2026-05-10T00:00:00.000Z',
            filename: 'modern.pdf',
            profile_score: 90,
            years_experience: 5,
            job_description_id: 15,
            parse_status: 'complete',
            job_title: 'Staff Engineer',
            latest_analysis_id: '501',
            latest_analysis_name: 'Modern analysis',
            latest_analysis_created_at: '2026-05-10T00:00:00.000Z',
            latest_analysis_completed_at: '2026-05-10T01:00:00.000Z',
            latest_analysis_status: 'complete',
            tags: ['interview', 'frontend'],
            total_count: 3,
          },
          {
            resume_id: legacyResumeId,
            profile: null,
            source_parse_job_id: null,
            source_updated_at: '2026-05-09T00:00:00.000Z',
            updated_at: '2026-05-09T00:00:00.000Z',
            filename: 'legacy-only.pdf',
            profile_score: null,
            years_experience: null,
            job_description_id: null,
            parse_status: null,
            job_title: null,
            latest_analysis_id: null,
            latest_analysis_name: null,
            latest_analysis_created_at: null,
            latest_analysis_completed_at: null,
            latest_analysis_status: null,
            tags: null,
            total_count: 3,
          },
          {
            resume_id: mixedResumeId,
            profile: {
              full_name: 'Mixed Candidate',
              skills: ['React', null, ''],
              years_experience: null,
              profile_score: null,
            },
            source_parse_job_id: 'analysis-mixed',
            source_updated_at: '2026-05-08T00:00:00.000Z',
            updated_at: '2026-05-08T00:00:00.000Z',
            filename: 'mixed.pdf',
            profile_score: null,
            years_experience: null,
            job_description_id: 16,
            parse_status: 'processing',
            job_title: 'Full Stack Engineer',
            latest_analysis_id: null,
            latest_analysis_name: null,
            latest_analysis_created_at: null,
            latest_analysis_completed_at: null,
            latest_analysis_status: null,
            tags: ['needs-review'],
            total_count: 3,
          },
        ],
      }
    }

    throw new Error(`Unexpected query: ${sql.slice(0, 80)}...`)
  })

  const app = buildApp()
  const server = app.listen(0)
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  const port = server.address().port

  const allResponse = await fetch(`http://127.0.0.1:${port}/candidates/directory`, {
    headers: authHeader(42),
  })
  const allPayload = await allResponse.json()

  assert.equal(allResponse.status, 200)
  for (const key of REQUIRED_RESPONSE_KEYS) {
    assert.ok(Object.hasOwn(allPayload, key), `missing required response key: ${key}`)
  }
  assert.equal(allPayload.totalCount, 3)
  assert.equal(allPayload.totalPages, 1)
  assert.equal(allPayload.sortBy, 'recent')
  assert.equal(allPayload.sortDirection, 'desc')
  assert.equal(allPayload.total, 3)
  assert.equal(allPayload.candidates.length, 3)

  for (const candidate of allPayload.candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), [...EXPECTED_KEYS].sort())
  }

  const modern = allPayload.candidates.find((entry) => entry.resumeId === modernResumeId)
  assert.equal(modern.name, 'Modern Candidate')
  assert.equal(modern.profileScore, 92)
  assert.equal(modern.yearsExperience, 6)
  assert.deepEqual(modern.topSkills, ['TypeScript', 'GraphQL', 'Kubernetes', 'Node.js', 'AWS'])
  assert.equal(modern.latestAnalysis.id, '501')

  const legacy = allPayload.candidates.find((entry) => entry.resumeId === legacyResumeId)
  assert.equal(legacy.name, 'legacy-only.pdf')
  assert.equal(legacy.email, null)
  assert.equal(legacy.profileScore, null)
  assert.equal(legacy.yearsExperience, null)
  assert.deepEqual(legacy.skills, [])
  assert.deepEqual(legacy.topSkills, [])
  assert.deepEqual(legacy.tags, [])
  assert.equal(legacy.latestAnalysis, null)
  assert.equal(legacy.dataCompleteness.profile, false)

  const mixed = allPayload.candidates.find((entry) => entry.resumeId === mixedResumeId)
  assert.equal(mixed.name, 'Mixed Candidate')
  assert.equal(mixed.profileScore, null)
  assert.equal(mixed.yearsExperience, null)
  assert.deepEqual(mixed.skills, ['React'])
  assert.deepEqual(mixed.topSkills, ['React'])
  assert.equal(mixed.latestAnalysis, null)

  const filteredResponse = await fetch(`http://127.0.0.1:${port}/candidates/directory?skills=react&scoreMin=80`, {
    headers: authHeader(42),
  })
  const filteredPayload = await filteredResponse.json()

  assert.equal(filteredResponse.status, 200)
  assert.equal(filteredPayload.totalCount, 0)
  assert.equal(filteredPayload.totalPages, 0)
  assert.equal(filteredPayload.total, 0)


  shouldFailSync = true
  const syncFailureResponse = await fetch(`http://127.0.0.1:${port}/candidates/directory`, {
    headers: authHeader(42),
  })
  const syncFailurePayload = await syncFailureResponse.json()
  assert.equal(syncFailureResponse.status, 200)
  assert.equal(syncFailurePayload.totalCount, 1)
  assert.equal(syncFailurePayload.candidates[0].name, 'historical-import.pdf')
  assert.deepEqual(syncFailurePayload.candidates[0].skills, [])
  assert.deepEqual(syncFailurePayload.candidates[0].topSkills, [])
  assert.equal(syncFailurePayload.candidates[0].profileScore, null)
  assert.equal(syncFailurePayload.candidates[0].yearsExperience, null)
  assert.equal(syncFailurePayload.candidates[0].latestAnalysis, null)

  assert.deepEqual(filteredPayload.filtersApplied, {
    skills: ['react'],
    tags: [],
    experienceMin: null,
    experienceMax: null,
    scoreMin: 80,
    scoreMax: null,
    sourceJobId: null,
    sourceAnalysisId: null,
    search: '',
    job: '',
  })
})


