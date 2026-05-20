import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAnalysisResultsPayload } from './analysisResultsSchema.js'

function withErrorSpy(fn) {
  const original = console.error
  const calls = []
  console.error = (...args) => calls.push(args)
  try {
    fn(calls)
  } finally {
    console.error = original
  }
}

test('accepts legacy-normalized payload shape and keeps candidates', () => {
  const { payload, isValid, issues } = validateAnalysisResultsPayload({
    candidates: [{ id: 'c-1', name: 'Candidate One', score: 82 }],
    parseMeta: { methodUsed: 'ai-extraction' },
    inputCount: 1,
    outputCount: 1,
    droppedCount: 0,
  })

  assert.equal(isValid, true)
  assert.equal(issues.length, 0)
  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.candidates[0].id, 'c-1')
  assert.equal(payload.candidates[0].matchScore.score, 82)
  assert.equal(payload.candidates[0].score, 82)
})



test('preserves legacy numeric matchScore when top-level score is absent', () => {
  const { payload, isValid, issues } = validateAnalysisResultsPayload({
    candidates: [{ id: 'legacy-1', name: 'Legacy Candidate', matchScore: 67 }],
  })

  assert.equal(isValid, true)
  assert.equal(issues.length, 0)
  assert.equal(payload.candidates[0].score, 67)
  assert.equal(payload.candidates[0].matchScore.score, 67)
})
test('rejects malformed shape and downgrades to safe defaults without throwing', () => {
  withErrorSpy((errorCalls) => {
    const { payload, isValid, issues } = validateAnalysisResultsPayload({
      candidates: [null, 1, { name: 42, score: 'bad' }],
      parseMeta: 'bad-meta',
      inputCount: '3',
    })

    assert.equal(isValid, false)
    assert.ok(issues.length >= 2)
    assert.equal(payload.candidates.length, 1)
    assert.equal(payload.candidates[0].id, 'candidate-2')
    assert.equal(payload.candidates[0].name, '42')
    assert.equal(payload.candidates[0].score, 0)
    assert.deepEqual(payload.parseMeta, {})
    assert.equal(errorCalls.length, 1)
    assert.equal(errorCalls[0][0], '[AnalysisResultsSchema] Validation issues detected.')
  })
})
