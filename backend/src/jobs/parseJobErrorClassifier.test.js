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


const deterministicLocalFailures = [
  ['docx_empty_extraction', 'docx_empty_extraction::Unable to extract text content from DOCX file resume.docx.'],
  ['docx_invalid_or_unreadable', 'docx_invalid_or_unreadable::DOCX file could not be read'],
  ['docx_dependency_missing', 'docx_dependency_missing::DOCX parsing dependency is unavailable'],
  ['docx_extraction_failed', 'docx_extraction_failed::Failed to extract DOCX text'],
  ['extraction_empty', 'extraction_empty::No parseable resume content was extracted'],
  ['legacy_word_format', 'legacy_word_format::Legacy .doc files are not supported'],
  ['resume_unsupported_legacy_doc', 'resume_unsupported_legacy_doc::Legacy Word format is not supported'],
  ['unsupported file format', 'unsupported file format: application/vnd.ms-word'],
  ['local payload validation', 'local payload validation failed: missing fileBufferBase64'],
]

for (const [name, message] of deterministicLocalFailures) {
  test(`${name} is non-retriable deterministic local failure`, () => {
    const result = classifyParseJobRetryability(new Error(message))
    assert.equal(result.retryable, false)
    assert.match(result.reason, /^deterministic_local_failure/)
  })
}


test('deterministic extraction category metadata is non-retriable even without a prefixed message', () => {
  const error = new Error('Unable to extract readable text from DOCX file resume.docx')
  error.extractionCategory = 'docx_empty_extraction'

  const result = classifyParseJobRetryability(error)

  assert.equal(result.retryable, false)
  assert.equal(result.reason, 'deterministic_local_failure:docx_empty_extraction')
})

test('local MIME and extension mismatches are non-retriable deterministic failures', () => {
  const result = classifyParseJobRetryability(new Error('MIME/extension mismatch: .docx upload reported as application/msword'))

  assert.equal(result.retryable, false)
  assert.equal(result.reason, 'deterministic_local_failure')
})

test('empty local payload validation is non-retriable', () => {
  const result = classifyParseJobRetryability(new Error('Resume payload is empty'))

  assert.equal(result.retryable, false)
  assert.equal(result.reason, 'deterministic_local_failure')
})

test('network timeout is retriable', () => {
  const result = classifyParseJobRetryability(new Error('Network timeout while connecting to provider'))
  assert.equal(result.retryable, true)
})

test('network connection errors are retriable', () => {
  const result = classifyParseJobRetryability(new Error('ECONNRESET network error while connecting to provider'))
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
