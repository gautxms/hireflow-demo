import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFailedAnalysisState, resolveSafeAnalyzeRoute } from './resumeUploaderRecoveryState.js'

test('failed parse keeps UI interactive with stable actions', () => {
  const state = buildFailedAnalysisState('provider timeout')

  assert.equal(state.message, 'Analysis failed')
  assert.equal(state.detail, 'We could not analyze resumes right now. Please retry.')
  assert.deepEqual(state.actions, ['retry', 'contact_support'])
})

test('route state remains valid after analyze exception', () => {
  assert.equal(resolveSafeAnalyzeRoute({ currentPage: 'uploader' }), 'uploader')
  assert.equal(resolveSafeAnalyzeRoute({ currentPage: 'nonexistent' }), 'uploader')
  assert.equal(resolveSafeAnalyzeRoute({}), 'uploader')
})
