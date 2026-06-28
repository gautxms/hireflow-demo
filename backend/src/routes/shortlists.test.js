import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBatchRemoveResponse, normalizeBatchResumeIds, resolveBatchAnalysisId } from './shortlists.js'

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
