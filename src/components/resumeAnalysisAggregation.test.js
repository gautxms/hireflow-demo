import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCandidatesByResumeId, summarizeJobStatus } from './resumeAnalysisAggregation.js'

test('mergeCandidatesByResumeId accumulates multiple resumes without overwriting previous entries', () => {
  const first = mergeCandidatesByResumeId({}, [
    { resumeId: 'resume-1', filename: 'alpha.pdf', candidate: { id: 'candidate-1', name: 'Alpha' } },
  ])

  const merged = mergeCandidatesByResumeId(first, [
    { resumeId: 'resume-2', filename: 'alpha.pdf', candidate: { id: 'candidate-2', name: 'Beta' } },
  ])

  assert.equal(Object.keys(merged).length, 2)
  assert.equal(merged['candidate-1'].resumeId, 'resume-1')
  assert.equal(merged['candidate-2'].resumeId, 'resume-2')
})

test('summarizeJobStatus reports uploaded/analyzed/failed/pending totals', () => {
  const summary = summarizeJobStatus([
    { status: 'complete' },
    { status: 'failed' },
    { status: 'processing' },
  ])

  assert.deepEqual(summary, {
    uploaded: 3,
    analyzed: 1,
    failed: 1,
    pending: 1,
  })
})
