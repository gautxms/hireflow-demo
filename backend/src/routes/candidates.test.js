import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import candidatesRouter, { buildDirectoryResponse, closeCandidateRouteResourcesForTests, isCandidateDirectorySyncOnReadEnabled, normalizeResumeTagLookupInput } from './candidates.js'
import { pool } from '../db/client.js'
import { parseQueue } from '../services/jobQueue.js'

after(async () => {
  closeCandidateRouteResourcesForTests()
  await parseQueue.close().catch(() => {})
  await pool.end().catch(() => {})
})

test('buildDirectoryResponse includes both legacy and new contract fields with safe defaults', () => {
  const candidates = [{ resumeId: '1' }, { resumeId: '2' }]
  const filtersApplied = { skills: [], sourceJobId: null, sourceAnalysisId: null }

  const response = buildDirectoryResponse(candidates, filtersApplied, {})

  assert.equal(response.total, 2)
  assert.equal(response.totalCount, 2)
  assert.equal(response.page, 1)
  assert.equal(response.pageSize, 15)
  assert.equal(response.totalPages, 1)
  assert.equal(response.sortBy, 'sourceUpdatedAt')
  assert.equal(response.sortDirection, 'desc')
  assert.deepEqual(response.candidates, candidates)
  assert.deepEqual(response.filtersApplied, filtersApplied)
})

test('buildDirectoryResponse honors provided pagination and sort params', () => {
  const candidates = [{ resumeId: '1' }, { resumeId: '2' }, { resumeId: '3' }, { resumeId: '4' }, { resumeId: '5' }]
  const response = buildDirectoryResponse(candidates, {}, {
    page: '2',
    pageSize: '2',
    sortBy: 'name',
    sortDirection: 'asc',
  })

  assert.equal(response.total, 5)
  assert.equal(response.totalCount, 5)
  assert.equal(response.page, 2)
  assert.equal(response.pageSize, 2)
  assert.equal(response.totalPages, 3)
  assert.equal(response.sortBy, 'name')
  assert.equal(response.sortDirection, 'asc')
  assert.deepEqual(response.candidates, [{ resumeId: '3' }, { resumeId: '4' }])
})

test('normalizeResumeTagLookupInput validates and de-duplicates resume IDs', () => {
  assert.equal(normalizeResumeTagLookupInput('bad'), null)
  assert.deepEqual(
    normalizeResumeTagLookupInput([
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440000',
      'not-a-uuid',
      '',
    ]),
    ['550e8400-e29b-41d4-a716-446655440000'],
  )
})


function createCandidateDirectoryApp() {
  const app = express()
  app.use(express.json())
  app.use('/candidates', candidatesRouter)
  return app
}

function authHeaders(userId = 42) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
  return { authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

function candidateProfileRows() {
  return [
    {
      resume_id: '11111111-1111-4111-8111-111111111111',
      profile: {
        name: 'Ada Lovelace',
        skills: { tools_and_platforms: ['React', 'Node'], methodologies: [], domain_expertise: [], soft_skills: [] },
        profile_score: 92,
        years_experience: 7,
      },
      source_parse_job_id: 'parse-job-1',
      source_updated_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      filename: 'ada.pdf',
      original_filename: 'ada.pdf',
      file_extension: 'pdf',
      file_type: 'application/pdf',
      profile_score: 91,
      years_experience: 6,
      parse_status: 'complete',
      job_description_id: '22222222-2222-4222-8222-222222222222',
      job_title: 'Frontend Engineer',
      tags: ['priority'],
    },
    {
      resume_id: '33333333-3333-4333-8333-333333333333',
      profile: {
        name: 'Grace Hopper',
        skills: { tools_and_platforms: ['Python'], methodologies: [], domain_expertise: [], soft_skills: [] },
        profile_score: 84,
        years_experience: 10,
      },
      source_parse_job_id: 'parse-job-2',
      source_updated_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      filename: 'grace.pdf',
      original_filename: 'grace.pdf',
      file_extension: 'pdf',
      file_type: 'application/pdf',
      profile_score: 80,
      years_experience: 9,
      parse_status: 'complete',
      job_description_id: null,
      job_title: null,
      tags: ['backend'],
    },
  ]
}

async function getJson(app, path) {
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: authHeaders() })
    return { status: response.status, body: await response.json() }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('candidate directory sync-on-read feature flag defaults off', () => {
  const previous = process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  try {
    assert.equal(isCandidateDirectorySyncOnReadEnabled(), false)
  } finally {
    if (previous === undefined) delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
    else process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ = previous
  }
})

test('GET /candidates/directory does not sync profiles by default and returns existing profiles', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql: String(sql), params })
    assert.doesNotMatch(String(sql), /FROM resumes r\s+LEFT JOIN LATERAL/)
    return { rows: candidateProfileRows() }
  })

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')

  assert.equal(status, 200)
  assert.equal(queries.length, 1)
  assert.equal(body.total, 2)
  assert.equal(body.totalCount, 2)
  assert.equal(body.candidates.length, 2)
  assert.equal(body.candidates[0].resumeId, '11111111-1111-4111-8111-111111111111')
  assert.equal(body.candidates[0].name, 'Ada Lovelace')
})

test('GET /candidates/directory returns a valid empty response when candidate_profiles is empty', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  t.mock.method(pool, 'query', async () => ({ rows: [] }))

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')

  assert.equal(status, 200)
  assert.deepEqual(body.candidates, [])
  assert.equal(body.total, 0)
  assert.equal(body.totalCount, 0)
  assert.equal(body.page, 1)
  assert.equal(body.totalPages, 1)
})

test('GET /candidates/directory preserves existing JS filter, sort, and page behavior', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  t.mock.method(pool, 'query', async () => ({ rows: candidateProfileRows() }))

  const { status, body } = await getJson(
    createCandidateDirectoryApp(),
    '/candidates/directory?skills=React&sortBy=profileScore&sortDirection=desc&page=1&pageSize=1',
  )

  assert.equal(status, 200)
  assert.equal(body.total, 1)
  assert.equal(body.totalCount, 1)
  assert.equal(body.pageSize, 1)
  assert.equal(body.sortBy, 'profileScore')
  assert.equal(body.sortDirection, 'desc')
  assert.equal(body.candidates.length, 1)
  assert.equal(body.candidates[0].name, 'Ada Lovelace')
  assert.deepEqual(body.filtersApplied.skills, ['react'])
})

test('GET /candidates/directory calls sync when CANDIDATE_DIRECTORY_SYNC_ON_READ=true', async (t) => {
  process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ })
  t.mock.method(console, 'info', () => {})
  const queries = []
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql)
    queries.push(text)
    if (/FROM resumes r\s+LEFT JOIN LATERAL/.test(text)) return { rows: [] }
    return { rows: [] }
  })

  const { status } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')

  assert.equal(status, 200)
  assert.equal(queries.some((sql) => /FROM resumes r\s+LEFT JOIN LATERAL/.test(sql)), true)
  assert.equal(queries.some((sql) => /FROM candidate_profiles cp/.test(sql)), true)
})

test('GET /candidates/directory candidate shape remains shortlist-compatible', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  t.mock.method(pool, 'query', async () => ({ rows: candidateProfileRows().slice(0, 1) }))

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')
  const candidate = body.candidates[0]

  assert.equal(status, 200)
  for (const key of ['resumeId', 'profile', 'name', 'skills', 'profileScore', 'yearsExperience', 'normalized', 'parseHints', 'provenanceHints', 'tags', 'sourceParseJobId', 'sourceUpdatedAt', 'associatedJob', 'parseStatus']) {
    assert.equal(Object.hasOwn(candidate, key), true, `missing ${key}`)
  }
  assert.equal(candidate.resumeId, '11111111-1111-4111-8111-111111111111')
})

test('async parse completion still upserts candidate profiles after completing analysis', () => {
  const source = fs.readFileSync(new URL('../jobs/parseResumeJob.js', import.meta.url), 'utf8')

  assert.match(source, /import \{ CANDIDATE_PROFILE_SCHEMA_VERSION, upsertCandidateProfile \}/)
  assert.match(source, /await setJobState\(job\.id, \{[\s\S]*?status: 'complete'[\s\S]*?\}\)/)
  assert.match(source, /await upsertCandidateProfile\(\{[\s\S]*?userId: job\.data\.userId,[\s\S]*?resumeId,[\s\S]*?profile: primaryCandidate,[\s\S]*?sourceParseJobId: job\.id,[\s\S]*?schemaVersion: CANDIDATE_PROFILE_SCHEMA_VERSION,[\s\S]*?\}\)\.catch/)
})

test('reanalysis path continues to sync profiles after mutating completed parse results', () => {
  const source = fs.readFileSync(new URL('./candidates.js', import.meta.url), 'utf8')
  const reanalyseRoute = source.slice(source.indexOf("router.post('/reanalyse'"), source.indexOf("router.get('/profiles'"))

  assert.match(reanalyseRoute, /UPDATE parse_jobs[\s\S]*SET result = \$2::jsonb/)
  assert.match(reanalyseRoute, /await syncCandidateProfilesForUser\(req\.userId\)/)
})

test('backend docs include candidate profile recovery runbook without making sync-on-read normal operation', () => {
  const docs = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

  assert.match(docs, /GET \/candidates\/directory` is a read path by default/)
  assert.match(docs, /CANDIDATE_DIRECTORY_SYNC_ON_READ=false/)
  assert.match(docs, /npm --prefix backend run backfill:candidate-profiles\n/)
  assert.match(docs, /npm --prefix backend run backfill:candidate-profiles:execute/)
  assert.match(docs, /npm --prefix backend run backfill:candidate-profiles -- --user-id <USER_ID>/)
  assert.match(docs, /Use the rollback flag only temporarily/)
})
