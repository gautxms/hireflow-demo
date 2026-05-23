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
  assert.equal(normalized.candidates[0].matchScore.score, 0)
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



test('CandidateResults does not invoke React hooks at module scope for selection helpers', () => {
  assert.doesNotMatch(
    candidateResultsSource,
    /\n}\s*const\s+resolveSelectionResumeId\s*=\s*useCallback\s*\(/,
  )
})

test('click-path regression: malformed expanded candidate only shows inline fallback note and keeps list rendering', () => {
  assert.match(
    candidateResultsSource,
    /\{isExpandedCandidateMissing && \(\s*<p className="candidate-results-page__empty-note" role="status">\s*Candidate details are unavailable for this entry\. Select another candidate from the list\./s,
  )
  assert.doesNotMatch(candidateResultsSource, /Back to Analyses/)
})

test('click-path regression: legacy matchScore numeric and object payload variants are both supported in score resolution', () => {
  assert.match(candidateResultsSource, /candidate\?\.matchScore\?\.score/)
  assert.match(candidateResultsSource, /candidate\?\.matchScore\s*\?\?/)
})

test('list/detail identity regression: candidate render keys derive from resolveCandidateKey instead of payload _bulkKey', () => {
  assert.match(candidateResultsSource, /const candidateKey = resolveCandidateKey\(candidate, index\)/)
  assert.match(candidateResultsSource, /<div\s+key=\{candidateKey\}/)
  assert.match(candidateResultsSource, /const expandedCandidateKey = detailVm\.candidateKey/)
  assert.match(candidateResultsSource, /selectedCandidateKey=\{expandedCandidateKey\}/)
  assert.doesNotMatch(candidateResultsSource, /key=\{candidate\._bulkKey\}/)
})

test('click-path regression: crash panel copy is never used for candidate click interactions', () => {
  assert.doesNotMatch(candidateResultsSource, /We could not render these results\./)
  assert.doesNotMatch(candidateResultsSource, /Please return to Analyses or retry\./)
})


test('candidate drawer includes labelled View resume section that uses existing open handler', () => {
  assert.match(candidateResultsSource, /<div className="dd-col-label section-heading dd-col-label--mt-16">View resume<\/div>/)
  assert.match(candidateResultsSource, /className="dd-resume-file"/)
  assert.match(candidateResultsSource, /\{detailVm\.resumeFileLabel\}/)
  assert.match(candidateResultsSource, /onClick=\{\(\) => openCandidateResumeInNewTab\(candidate\)\}/)
  assert.match(candidateResultsSource, /disabled=\{!hasResumeForOpen\}/)
})
