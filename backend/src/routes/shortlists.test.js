import assert from 'node:assert/strict'
import test from 'node:test'

import { batchAddShortlistCandidates, buildBatchRemoveResponse, normalizeBatchResumeIds, resolveBatchAnalysisId } from './shortlists.js'

const uuidA = '11111111-1111-4111-8111-111111111111'
const uuidB = '22222222-2222-4222-8222-222222222222'
const staleParseJobId = 'parse_job_123'

test('normalizeBatchResumeIds returns only valid UUIDs and tracks invalid inputs', () => {
  const normalized = normalizeBatchResumeIds([uuidA, uuidA.toUpperCase(), staleParseJobId, { resumeId: uuidB }, { candidateId: 'not-a-uuid' }, null, ''])

  assert.deepEqual(normalized.valid, [uuidA, uuidB])
  assert.deepEqual(normalized.invalid, [staleParseJobId, 'not-a-uuid'])
})

test('resolveBatchAnalysisId ignores null, invalid, and stale analysis-like IDs', () => {
  assert.equal(resolveBatchAnalysisId(uuidA, { [uuidA]: { analysisId: staleParseJobId } }), null)
  assert.equal(resolveBatchAnalysisId(uuidA, { [uuidA]: { analysisId: null } }), null)
})

test('resolveBatchAnalysisId accepts valid UUID analysis IDs from source context and snapshots', () => {
  assert.equal(resolveBatchAnalysisId(uuidA, { [uuidA]: { analysisId: uuidB } }), uuidB)
  assert.equal(resolveBatchAnalysisId(uuidA, {}, { [uuidA]: { sourceAnalysisId: uuidB } }), uuidB)
})


test('normalizeBatchResumeIds lowercases uppercase UUIDs and dedupes canonical matches', () => {
  const normalized = normalizeBatchResumeIds([uuidA.toUpperCase(), uuidA, { resumeId: uuidB.toUpperCase() }])

  assert.deepEqual(normalized.valid, [uuidA, uuidB])
  assert.deepEqual(normalized.invalid, [])
})

test('buildBatchRemoveResponse reports malformed IDs without hiding valid removals', () => {
  const response = buildBatchRemoveResponse({
    shortlistId: 'shortlist-1',
    resumeIds: [uuidA, uuidB],
    malformedIds: ['not-a-uuid'],
    removedIds: [uuidA],
  })

  assert.equal(response.ok, false)
  assert.equal(response.partialFailure, true)
  assert.deepEqual(response.summary, {
    requested: 3,
    removed: 1,
    notPresent: 1,
    invalid: 1,
  })
  assert.deepEqual(response.outcomes, [
    {
      resumeId: 'not-a-uuid',
      ok: false,
      code: 'invalid_resume_id',
      message: 'Invalid resume ID format',
    },
    { resumeId: uuidA, ok: true, code: 'removed' },
    { resumeId: uuidB, ok: true, code: 'not_present' },
  ])
})

function createBatchAddDb({ visibleIds = [], existingIds = [], allowedAnalysisIds = [], failOnStage = null } = {}) {
  const calls = []
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (/FROM shortlists WHERE/.test(sql)) {
        if (failOnStage === 'owner_check') throw Object.assign(new Error('owner check failed'), { code: 'XX001' })
        return { rows: [{ id: params[0] }] }
      }
      if (/FROM resumes/.test(sql)) {
        if (failOnStage === 'visible_resumes_check') throw Object.assign(new Error('visible resumes failed'), { code: 'XX002' })
        return { rows: visibleIds.map((id) => ({ id })) }
      }
      if (/FROM shortlist_candidates/.test(sql) && /^\s*SELECT resume_id/.test(sql)) {
        if (failOnStage === 'existing_shortlist_candidates_check') throw Object.assign(new Error('existing check failed'), { code: 'XX003' })
        return { rows: existingIds.map((resume_id) => ({ resume_id })) }
      }
      if (/FROM analyses/.test(sql)) {
        if (failOnStage === 'allowed_analysis_ids_check') throw Object.assign(new Error('analysis check failed'), { code: 'XX004' })
        return { rows: allowedAnalysisIds.map((id) => ({ id })) }
      }
      if (/INSERT INTO shortlist_candidates/.test(sql)) {
        if (failOnStage === 'insert_shortlist_candidates') throw Object.assign(new Error('column "source_context" of relation "shortlist_candidates" does not exist'), { code: '42703', table: 'shortlist_candidates', column: 'source_context' })
        return { rows: [], rowCount: JSON.parse(params[5]).length }
      }
      throw new Error(`Unexpected SQL in mock: ${sql}`)
    },
  }
  return db
}

test('batchAddShortlistCandidates inserts multiple valid resume IDs successfully', async () => {
  const db = createBatchAddDb({ visibleIds: [uuidA, uuidB] })
  const result = await batchAddShortlistCandidates({ db, shortlistId: uuidA, userId: 7, resumeIds: [uuidA, uuidB] })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.summary.succeeded, 2)
  assert.equal(result.body.summary.added, 2)
  assert.equal(result.body.summary.updated, 0)
})

test('batchAddShortlistCandidates updates candidates already in the shortlist', async () => {
  const db = createBatchAddDb({ visibleIds: [uuidA, uuidB], existingIds: [uuidA, uuidB] })
  const result = await batchAddShortlistCandidates({ db, shortlistId: uuidA, userId: 7, resumeIds: [uuidA, uuidB] })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.summary.added, 0)
  assert.equal(result.body.summary.updated, 2)
  assert.deepEqual(result.body.outcomes.map((outcome) => outcome.code), ['updated/already-present', 'updated/already-present'])
})

test('batchAddShortlistCandidates keeps valid inserts when selection has partial invalid IDs', async () => {
  const db = createBatchAddDb({ visibleIds: [uuidA] })
  const result = await batchAddShortlistCandidates({ db, shortlistId: uuidA, userId: 7, resumeIds: [uuidA, uuidB], malformedIds: ['not-a-uuid'] })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, false)
  assert.equal(result.body.partialFailure, true)
  assert.equal(result.body.summary.succeeded, 1)
  assert.equal(result.body.summary.failed, 2)
  assert.equal(result.body.summary.added, 1)
})

test('batchAddShortlistCandidates supports null analysis_id, source_context, and candidate_snapshot', async () => {
  const db = createBatchAddDb({ visibleIds: [uuidA] })
  const result = await batchAddShortlistCandidates({ db, shortlistId: uuidA, userId: 7, resumeIds: [uuidA] })

  assert.equal(result.body.ok, true)
  const insertCall = db.calls.find((call) => /INSERT INTO shortlist_candidates/.test(call.sql))
  const rows = JSON.parse(insertCall.params[5])
  assert.deepEqual(rows, [{ resume_id: uuidA, analysis_id: null, source_context: null, candidate_snapshot: null }])
})

test('batchAddShortlistCandidates stores null for optional analysis_id that does not exist', async () => {
  const db = createBatchAddDb({ visibleIds: [uuidA], allowedAnalysisIds: [] })
  const result = await batchAddShortlistCandidates({
    db,
    shortlistId: uuidA,
    userId: 7,
    resumeIds: [uuidA],
    sourceContextByResumeId: { [uuidA]: { analysisId: uuidB, parseJobId: 'parse-job-safe' } },
  })

  assert.equal(result.body.ok, true)
  const insertCall = db.calls.find((call) => /INSERT INTO shortlist_candidates/.test(call.sql))
  const rows = JSON.parse(insertCall.params[5])
  assert.equal(rows[0].analysis_id, null)
  assert.deepEqual(rows[0].source_context, { analysisId: uuidB, parseJobId: 'parse-job-safe' })
})

test('batchAddShortlistCandidates annotates the exact failing DB stage for RCA logs', async () => {
  const db = createBatchAddDb({ visibleIds: [uuidA], failOnStage: 'insert_shortlist_candidates' })
  await assert.rejects(
    batchAddShortlistCandidates({ db, shortlistId: uuidA, userId: 7, resumeIds: [uuidA] }),
    (error) => {
      assert.equal(error.shortlistBatchStage, 'insert_shortlist_candidates')
      assert.equal(error.code, '42703')
      assert.equal(error.column, 'source_context')
      return true
    },
  )
})
