import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RESULTS_EMPTY_STATE_COPY,
  getSharedResultsToken,
  isResultsRootPath,
  isSharedResultsPath,
} from './resultsRouteContract.js'

test('route contract distinguishes /results and /results/:token', () => {
  assert.equal(isResultsRootPath('/results'), true)
  assert.equal(isResultsRootPath('/results/token'), false)
  assert.equal(isSharedResultsPath('/results'), false)
  assert.equal(isSharedResultsPath('/results/share-token'), true)
})

test('shared token parsing decodes URL encoding and rejects deeper paths', () => {
  assert.equal(getSharedResultsToken('/results/abc%20123'), 'abc 123')
  assert.equal(getSharedResultsToken('/results/abc/def'), '')
})

test('shared token parsing fails closed on malformed encoding', () => {
  assert.equal(getSharedResultsToken('/results/%E0%A4%A'), '')
  assert.equal(isSharedResultsPath('/results/%E0%A4%A'), false)
})

test('results empty-state copy remains contract-stable', () => {
  assert.deepEqual(RESULTS_EMPTY_STATE_COPY, {
    title: 'No recent analysis found',
    description: 'We couldn’t find a recent resume analysis for your account. Upload resumes to start a new analysis.',
    action: 'Go to uploader',
  })
})
