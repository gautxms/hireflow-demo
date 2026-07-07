import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import candidatesRouter, { buildDirectoryResponse, closeCandidateRouteResourcesForTests, isCandidateDirectorySqlPaginationEnabled, isCandidateDirectorySyncOnReadEnabled, normalizeResumeTagLookupInput } from './candidates.js'
import { resolveProfilePayload } from '../services/candidateProfilesService.js'
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


function mockDirectoryQueries(t, rows = candidateProfileRows(), totalCount = rows.length) {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql)
    queries.push({ sql: text, params })
    if (/COUNT\(\*\)::integer AS total_count/.test(text)) return { rows: [{ total_count: totalCount }] }
    return { rows }
  })
  return queries
}


function mockDirectoryJsQuery(t, rows = candidateProfileRows()) {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql: String(sql), params })
    return { rows }
  })
  return queries
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


test('candidate directory SQL pagination feature flag defaults off', () => {
  const previous = process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION
  delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION
  try {
    assert.equal(isCandidateDirectorySqlPaginationEnabled(), false)
  } finally {
    if (previous === undefined) delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION
    else process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = previous
  }
})

test('GET /candidates/directory uses JS path by default and returns existing profiles', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  const queries = mockDirectoryJsQuery(t)

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')

  assert.equal(status, 200)
  assert.equal(queries.length, 1)
  assert.doesNotMatch(queries[0].sql, /COUNT\(\*\)::integer AS total_count/)
  assert.doesNotMatch(queries[0].sql, /LIMIT \$\d+ OFFSET \$\d+/)
  assert.equal(body.total, 2)
  assert.equal(body.totalCount, 2)
  assert.equal(body.candidates.length, 2)
  assert.equal(body.candidates[0].resumeId, '11111111-1111-4111-8111-111111111111')
  assert.equal(body.candidates[0].name, 'Ada Lovelace')
  assert.equal(logs[0][1].sql_pagination_enabled, false)
})

test('GET /candidates/directory returns a valid empty response when candidate_profiles is empty', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  mockDirectoryJsQuery(t, [])

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')

  assert.equal(status, 200)
  assert.deepEqual(body.candidates, [])
  assert.equal(body.total, 0)
  assert.equal(body.totalCount, 0)
  assert.equal(body.page, 1)
  assert.equal(body.totalPages, 1)
})

test('GET /candidates/directory uses SQL path when enabled and preserves filter, sort, and page behavior', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  t.mock.method(console, 'info', () => {})
  mockDirectoryQueries(t, candidateProfileRows().slice(0, 1), 1)

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

test('GET /candidates/directory builds parameterized SQL filters without logging raw search text', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  const queries = mockDirectoryQueries(t, candidateProfileRows().slice(0, 1), 1)

  const { status } = await getJson(
    createCandidateDirectoryApp(),
    '/candidates/directory?search=AdaSecret&job=Frontend&parseStatus=complete&skills=React&tags=Priority&experienceMin=5&experienceMax=10&scoreMin=80&scoreMax=100&sourceJobId=22222222-2222-4222-8222-222222222222&sourceAnalysisId=parse-job-1&sortBy=profileScore&sortDirection=desc&pageSize=15',
  )

  assert.equal(status, 200)
  assert.equal(queries.length, 2)
  assert.match(queries[1].sql, /LOWER\(candidate_name\) LIKE \$2/)
  assert.match(queries[1].sql, /effective_profile_score >= \$\d+/)
  assert.match(queries[1].sql, /ORDER BY effective_profile_score DESC NULLS LAST/)
  assert.match(queries[1].sql, /LIMIT \$\d+ OFFSET \$\d+/)
  assert.equal(queries[1].sql.includes('AdaSecret'), false)
  assert.equal(queries[1].params.includes('%adasecret%'), true)
  assert.equal(JSON.stringify(logs).includes('AdaSecret'), false)
})

test('GET /candidates/directory clamps out-of-range pages before fetching', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  t.mock.method(console, 'info', () => {})
  const queries = mockDirectoryQueries(t, candidateProfileRows().slice(1), 2)

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory?page=99&pageSize=1')

  assert.equal(status, 200)
  assert.equal(body.page, 2)
  assert.equal(body.totalPages, 2)
  assert.deepEqual(queries[1].params.slice(-2), [1, 1])
})


test('GET /candidates/directory SQL path trims legacy comma-separated skills for exact filtering', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  t.mock.method(console, 'info', () => {})
  const row = {
    ...candidateProfileRows()[0],
    profile: { ...candidateProfileRows()[0].profile, skills: 'React, Node' },
  }
  const queries = mockDirectoryQueries(t, [row], 1)

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory?skills=Node')

  assert.equal(status, 200)
  assert.match(queries[1].sql, /array_agg\(DISTINCT BTRIM\(skill_value\)\)/)
  assert.deepEqual(queries[1].params.find((param) => Array.isArray(param)), ['node'])
  assert.equal(body.candidates.length, 1)
  assert.equal(body.candidates[0].name, 'Ada Lovelace')
})

test('GET /candidates/directory SQL path uses trimmed skills for search without logging raw search text', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  const row = {
    ...candidateProfileRows()[0],
    profile: { ...candidateProfileRows()[0].profile, skills: { tools_and_platforms: [' React ', ' Node '] } },
  }
  const queries = mockDirectoryQueries(t, [row], 1)

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory?search=NodeSecret')

  assert.equal(status, 200)
  assert.match(queries[1].sql, /array_agg\(DISTINCT BTRIM\(skill_value\)\)/)
  assert.match(queries[1].sql, /unnest\(skills_flat\)/)
  assert.equal(queries[1].sql.includes('NodeSecret'), false)
  assert.equal(JSON.stringify(logs).includes('NodeSecret'), false)
  assert.equal(body.candidates.length, 1)
})

test('GET /candidates/directory SQL numeric ascending sorts put missing values first', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  t.mock.method(console, 'info', () => {})
  let queries = mockDirectoryQueries(t)

  let response = await getJson(createCandidateDirectoryApp(), '/candidates/directory?sortBy=profileScore&sortDirection=asc')

  assert.equal(response.status, 200)
  assert.match(queries[1].sql, /ORDER BY effective_profile_score ASC NULLS FIRST/)

  t.mock.restoreAll()
  t.mock.method(console, 'info', () => {})
  queries = mockDirectoryQueries(t)

  response = await getJson(createCandidateDirectoryApp(), '/candidates/directory?sortBy=yearsExperience&sortDirection=asc')

  assert.equal(response.status, 200)
  assert.match(queries[1].sql, /ORDER BY effective_years_experience ASC NULLS FIRST/)
})

test('GET /candidates/directory SQL numeric descending sorts put missing values last', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  t.mock.method(console, 'info', () => {})
  let queries = mockDirectoryQueries(t)

  let response = await getJson(createCandidateDirectoryApp(), '/candidates/directory?sortBy=profileScore&sortDirection=desc')

  assert.equal(response.status, 200)
  assert.match(queries[1].sql, /ORDER BY effective_profile_score DESC NULLS LAST/)

  t.mock.restoreAll()
  t.mock.method(console, 'info', () => {})
  queries = mockDirectoryQueries(t)

  response = await getJson(createCandidateDirectoryApp(), '/candidates/directory?sortBy=yearsExperience&sortDirection=desc')

  assert.equal(response.status, 200)
  assert.match(queries[1].sql, /ORDER BY effective_years_experience DESC NULLS LAST/)
})

test('GET /candidates/directory falls back to safe sort defaults for invalid sort params', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION = 'true'
  t.after(() => { delete process.env.CANDIDATE_DIRECTORY_SQL_PAGINATION })
  t.mock.method(console, 'info', () => {})
  const queries = mockDirectoryQueries(t)

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory?sortBy=unsafe_sql&sortDirection=sideways')

  assert.equal(status, 200)
  assert.equal(body.sortBy, 'sourceUpdatedAt')
  assert.equal(body.sortDirection, 'desc')
  assert.match(queries[1].sql, /ORDER BY cp\.source_updated_at DESC NULLS LAST/)
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
    if (/COUNT\(\*\)::integer AS total_count/.test(text)) return { rows: [{ total_count: 0 }] }
    return { rows: [] }
  })

  const { status } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')

  assert.equal(status, 200)
  assert.equal(queries.some((sql) => /FROM resumes r\s+LEFT JOIN LATERAL/.test(sql)), true)
  assert.equal(queries.some((sql) => /FROM candidate_profiles cp/.test(sql)), true)
})


test('GET /candidates/directory exposes JD-fit score metadata without changing profileScore', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  const row = {
    ...candidateProfileRows()[0],
    profile: {
      ...candidateProfileRows()[0].profile,
      name: 'Sophia Martinez',
      profile_score: 78,
      matchScore: { score: 87 },
    },
    profile_score: 78,
  }
  mockDirectoryJsQuery(t, [row])

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')
  const candidate = body.candidates[0]

  assert.equal(status, 200)
  assert.equal(candidate.profileScore, 78)
  assert.equal(candidate.scoreRaw, 87)
  assert.equal(candidate.scoreDisplay, '8.7')
  assert.equal(candidate.scoreContext, 'jd_fit')
  assert.equal(candidate.scoreSource, 'matchScore.score')
  assert.deepEqual(candidate.scoreMetadata, {
    raw: 87,
    display: '8.7',
    unit: 'raw_0_100',
    displayUnit: 'out_of_10',
    source: 'matchScore.score',
    context: 'jd_fit',
    sourceParseJobId: 'parse-job-1',
    sourceJobId: '22222222-2222-4222-8222-222222222222',
    sourceUpdatedAt: '2026-01-02T00:00:00.000Z',
  })
})

test('GET /candidates/directory uses profile score metadata for resume-only candidates with match score', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  const row = {
    ...candidateProfileRows()[1],
    profile: {
      ...candidateProfileRows()[1].profile,
      profile_score: 78,
      matchScore: { score: 87 },
    },
    profile_score: 78,
    job_description_id: null,
  }
  mockDirectoryJsQuery(t, [row])

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')
  const candidate = body.candidates[0]

  assert.equal(status, 200)
  assert.equal(candidate.profileScore, 78)
  assert.equal(candidate.scoreRaw, 78)
  assert.equal(candidate.scoreDisplay, '7.8')
  assert.equal(candidate.scoreContext, 'profile_only')
  assert.equal(candidate.scoreSource, 'profile_score')
  assert.notEqual(candidate.scoreContext, 'jd_fit')
})

test('GET /candidates/directory falls back to legacy score metadata when no match score exists', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  const row = {
    ...candidateProfileRows()[1],
    profile: {
      name: 'Legacy Candidate',
      score: 82,
      skills: [],
    },
    profile_score: null,
    job_description_id: null,
  }
  mockDirectoryJsQuery(t, [row])

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')
  const candidate = body.candidates[0]

  assert.equal(status, 200)
  assert.equal(candidate.scoreRaw, 82)
  assert.equal(candidate.scoreDisplay, '8.2')
  assert.equal(candidate.scoreContext, 'legacy')
  assert.equal(candidate.scoreSource, 'score')
})

test('GET /candidates/directory marks missing or invalid score metadata as missing', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  const row = {
    ...candidateProfileRows()[1],
    profile: {
      name: 'No Score Candidate',
      profile_score: 'not-a-score',
      matchScore: { score: 'bad' },
      skills: [],
    },
    profile_score: null,
    job_description_id: null,
  }
  mockDirectoryJsQuery(t, [row])

  const { status, body } = await getJson(createCandidateDirectoryApp(), '/candidates/directory')
  const candidate = body.candidates[0]

  assert.equal(status, 200)
  assert.equal(candidate.scoreRaw, null)
  assert.equal(candidate.scoreDisplay, null)
  assert.equal(candidate.scoreContext, 'missing')
  assert.equal(candidate.scoreSource, 'missing')
})

test('candidate profile payload resolution prefers latest completed parse job candidate over stale resume parse result', () => {
  const resolved = resolveProfilePayload({
    resumeParseResult: { candidates: [{ name: 'Sophia Martinez', profile_score: 78 }] },
    resumeUpdatedAt: '2026-01-01T00:00:00.000Z',
    parseJobResult: { candidates: [{ name: 'Sophia Martinez', profile_score: 78, matchScore: { score: 87 } }] },
    parseJobUpdatedAt: '2026-01-02T00:00:00.000Z',
    parseJobId: 'parse-job-latest',
  })

  assert.equal(resolved.profile.matchScore.score, 87)
  assert.equal(resolved.sourceParseJobId, 'parse-job-latest')
  assert.equal(resolved.sourceUpdatedAt, '2026-01-02T00:00:00.000Z')
})

test('candidate profile payload resolution skips aggregate reanalysis parse job snapshots', () => {
  const resolved = resolveProfilePayload({
    resumeParseResult: { candidates: [{ name: 'Attached Resume Candidate', profile_score: 78 }] },
    resumeUpdatedAt: '2026-01-01T00:00:00.000Z',
    parseJobResult: {
      candidates: [
        { name: 'Different Reanalysed Candidate', profile_score: 92, matchScore: { score: 94 } },
        { name: 'Attached Resume Candidate', profile_score: 81, matchScore: { score: 88 } },
      ],
    },
    parseJobUpdatedAt: '2026-01-02T00:00:00.000Z',
    parseJobId: 'aggregate-reanalyse-job',
  })

  assert.equal(resolved.profile.name, 'Attached Resume Candidate')
  assert.equal(resolved.profile.profile_score, 78)
  assert.equal(resolved.sourceParseJobId, null)
  assert.equal(resolved.sourceUpdatedAt, '2026-01-01T00:00:00.000Z')
})

test('GET /candidates/directory candidate shape remains shortlist-compatible', async (t) => {
  delete process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ
  t.mock.method(console, 'info', () => {})
  mockDirectoryJsQuery(t, candidateProfileRows().slice(0, 1))

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
