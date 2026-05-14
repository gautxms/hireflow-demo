import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeCandidateResultsPayload } from './candidateResultsPayload.js'

const candidateResultsSource = readFileSync(new URL('./CandidateResults.jsx', import.meta.url), 'utf8')

test('normalizeCandidateResultsPayload handles empty payload', () => {
  assert.deepEqual(normalizeCandidateResultsPayload(null), {
    candidates: [],
    parseMeta: {},
    isInvalid: false,
  })
})

test('normalizeCandidateResultsPayload handles array payload', () => {
  const candidate = { id: 'c1', name: 'Alice' }
  const normalized = normalizeCandidateResultsPayload([candidate])
  assert.equal(normalized.isInvalid, false)
  assert.equal(normalized.candidates[0].matchScore.score, null)
  assert.equal(typeof normalized.candidates[0].matchScore.reason, 'string')
})

test('normalizeCandidateResultsPayload handles object payload with parseMeta', () => {
  const payload = {
    candidates: [{ id: 'c2', name: 'Bob' }],
    parseMeta: { hasJobDescription: true, source: 'parse-job-1' },
  }
  const normalized = normalizeCandidateResultsPayload(payload)
  assert.equal(normalized.isInvalid, false)
  assert.equal(normalized.parseMeta.source, 'parse-job-1')
  assert.equal(normalized.candidates[0].name, 'Bob')
  assert.equal(typeof normalized.candidates[0].matchScore.reason, 'string')
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

test('CandidateResults title contract: analysis title does not fall back to job description fields', () => {
  assert.match(candidateResultsSource, /return resolved \|\| 'Analysis Results'/)
  assert.match(
    candidateResultsSource,
    /const candidateFields = \[\s*firstCandidate\?\.analysisName,\s*firstCandidate\?\.analysisTitle,\s*firstCandidate\?\.analysis_name,\s*\]/s,
  )
})

test('CandidateResults renders processing issues panel and keeps core fit sections', () => {
  assert.match(candidateResultsSource, /Resume processing issues/)
  assert.match(candidateResultsSource, /Missing requirements/)
  assert.match(candidateResultsSource, /skillSignals\.label/)
  assert.match(candidateResultsSource, /Resume integrity checks/)
})

test('CandidateResults keeps reasoning visible in default assessment panel copy', () => {
  assert.match(candidateResultsSource, /<div className=\"dd-col-label dd-col-label--mt-16\">Why<\/div>/)
  assert.match(candidateResultsSource, /reasoningText/)
})
