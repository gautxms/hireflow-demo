import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCandidateResultsPayload } from './candidateResultsPayload.js'

test('normalizes invalid payload to empty shape', () => {
  assert.deepEqual(normalizeCandidateResultsPayload(null), {
    candidates: [],
    parseMeta: {},
    isInvalid: false,
  })

  assert.deepEqual(normalizeCandidateResultsPayload('bad'), {
    candidates: [],
    parseMeta: {},
    isInvalid: true,
  })
})

test('normalizes payload candidates and parseMeta object', () => {
  const payload = normalizeCandidateResultsPayload({
    candidates: [{ id: '1' }],
    parseMeta: { hasJobDescription: true },
  })

  assert.equal(payload.isInvalid, false)
  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.parseMeta.hasJobDescription, true)
  assert.equal(payload.candidates[0].matchScore.score, 0)
  assert.equal(typeof payload.candidates[0].matchScore.reason, 'string')
})
