import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCandidateResultsPayload } from './candidateResultsPayload.js'

test('normalizeCandidateResultsPayload handles empty payload', () => {
  assert.deepEqual(normalizeCandidateResultsPayload(null), {
    candidates: [],
    parseMeta: null,
    isInvalid: false,
  })
})

test('normalizeCandidateResultsPayload handles array payload', () => {
  const candidate = { id: 'c1', name: 'Alice' }
  assert.deepEqual(normalizeCandidateResultsPayload([candidate]), {
    candidates: [candidate],
    parseMeta: null,
    isInvalid: false,
  })
})

test('normalizeCandidateResultsPayload handles object payload with parseMeta', () => {
  const payload = {
    candidates: [{ id: 'c2', name: 'Bob' }],
    parseMeta: { hasJobDescription: true, source: 'parse-job-1' },
  }
  assert.deepEqual(normalizeCandidateResultsPayload(payload), {
    candidates: payload.candidates,
    parseMeta: payload.parseMeta,
    isInvalid: false,
  })
})

test('normalizeCandidateResultsPayload handles shared results payload', () => {
  const payload = {
    candidates: [{ id: 'shared-1', name: 'Casey' }],
    parseMeta: { shared: true },
  }
  const normalized = normalizeCandidateResultsPayload(payload)
  assert.equal(normalized.candidates[0].id, 'shared-1')
  assert.equal(normalized.parseMeta?.shared, true)
  assert.equal(normalized.isInvalid, false)
})
