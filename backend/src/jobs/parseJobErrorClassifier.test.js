import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyParseJobRetryability,
  NonRetriableParseError,
} from './parseJobErrorClassifier.js'

test('invalid integer cast is non-retriable', () => {
  const result = classifyParseJobRetryability(new Error('invalid input syntax for type integer: "3.5"'))
  assert.equal(result.retryable, false)
})

test('schema mismatch is non-retriable', () => {
  const result = classifyParseJobRetryability(new Error('column years_experience does not exist'))
  assert.equal(result.retryable, false)
})

test('local request validation failure is non-retriable', () => {
  const result = classifyParseJobRetryability(new Error('local request validation failed: missing resumeId'))
  assert.equal(result.retryable, false)
})

test('network timeout is retriable', () => {
  const result = classifyParseJobRetryability(new Error('Network timeout while connecting to provider'))
  assert.equal(result.retryable, true)
})

test('response_truncated_error remains retryable provider behavior', () => {
  const result = classifyParseJobRetryability(new Error('response_truncated_error::{"technicalDetails":"stop_reason=max_tokens"}'))
  assert.equal(result.retryable, true)
})

test('explicit NonRetriableParseError marker is non-retriable', () => {
  const result = classifyParseJobRetryability(new NonRetriableParseError('deterministic failure'))
  assert.equal(result.retryable, false)
})
