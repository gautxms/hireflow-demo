import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeBatchResumeIds, resolveBatchAnalysisId } from './shortlists.js'

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
