import test from 'node:test'
import assert from 'node:assert/strict'
import { toCandidateResultsPayload } from './analysisDetailPayload.js'

function withWarnSpy(fn) {
  const originalWarn = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)
  try {
    fn(calls)
  } finally {
    console.warn = originalWarn
  }
}

test('toCandidateResultsPayload keeps valid candidates and drops malformed entries without invalidating payload', () => {
  withWarnSpy((warnCalls) => {
    const payload = toCandidateResultsPayload({
      id: 'analysis-1',
      status: 'complete',
      candidates: [
        { id: 'valid-1', name: 'Valid Candidate', matchScore: 74, scoreBreakdown: { overall: 74 } },
        null,
        'bad',
        { id: 'valid-2', name: 'Another', matchScore: '91.2', assessment: null },
        { id: 'missing-nested', name: 42, scoreBreakdown: null, assessment: 'oops' },
        7,
        { id: 'invalid-score', name: 'Clamped', matchScore: Infinity, score: -10 },
      ],
    })

    assert.equal(payload.candidates.length, 4)
    assert.equal(payload.hasPartiallyInvalidPayload, true)
    assert.equal(payload.hasInvalidPayload, false)
    assert.equal(payload.droppedCount, 3)

    assert.equal(payload.candidates[0].id, 'valid-1')
    assert.equal(payload.candidates[1].matchScore, 91.2)
    assert.equal(payload.candidates[2].name, '42')
    assert.equal(payload.candidates[2].scoreBreakdown.overall, 0)
    assert.equal(payload.candidates[3].matchScore, 0)
    assert.equal(payload.candidates[3].score, 0)

    assert.equal(warnCalls.length, 1)
    assert.equal(warnCalls[0][0], '[AnalysisDetailPage] Candidate normalization dropped invalid records.')
    assert.deepEqual(warnCalls[0][1], {
      droppedCount: 3,
      inputCount: 7,
      outputCount: 4,
      analysisId: 'analysis-1',
    })
  })
})

test('toCandidateResultsPayload handles all-invalid candidates gracefully', () => {
  withWarnSpy((warnCalls) => {
    const payload = toCandidateResultsPayload({
      id: 'analysis-2',
      status: 'complete',
      candidates: [null, undefined, 1, 'oops', false],
    })

    assert.equal(payload.candidates.length, 0)
    assert.equal(payload.hasInvalidPayload, true)
    assert.equal(payload.hasPartiallyInvalidPayload, false)
    assert.equal(payload.inputCount, 5)
    assert.equal(payload.outputCount, 0)
    assert.equal(payload.droppedCount, 5)
    assert.equal(warnCalls.length, 1)
  })
})

test('toCandidateResultsPayload can normalize nested item result candidates from terminal analysis responses', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-3',
    liveStatus: 'complete',
    items: [
      {
        resumeId: 'resume-1',
        filename: 'resume-1.pdf',
        result: JSON.stringify({
          status: 'complete',
          candidates: [{ id: 'c-1', name: 'Nested Candidate', matchScore: 88 }, null],
        }),
      },
    ],
  })

  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.candidates[0].id, 'c-1')
  assert.equal(payload.candidates[0].resumeId, 'resume-1')
  assert.equal(payload.candidates[0].filename, 'resume-1.pdf')
  assert.equal(payload.hasPartiallyInvalidPayload, false)
  assert.equal(payload.hasInvalidPayload, false)
})
