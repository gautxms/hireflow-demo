import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProviderError } from './parseProviderError.js'

test('normalizeProviderError maps invalid request errors', () => {
  const result = normalizeProviderError('invalid_request_error: unsupported model')

  assert.equal(result.category, 'invalid_request_error')
  assert.equal(result.userMessage, 'AI model configuration issue in Admin Security.')
  assert.equal(result.normalizedMessage, 'invalid_request_error::invalid_request_error: unsupported model')
})

test('normalizeProviderError maps auth failures', () => {
  const result = normalizeProviderError(new Error('Unauthorized: invalid API key'))

  assert.equal(result.category, 'auth_error')
  assert.equal(result.userMessage, 'AI key invalid or expired.')
  assert.equal(result.normalizedMessage, 'auth_error::Unauthorized: invalid API key')
})

test('normalizeProviderError maps provider throttling and timeouts to retry category', () => {
  const rateLimited = normalizeProviderError('Rate limit exceeded (429)')
  const timedOut = normalizeProviderError('Network timeout while connecting to provider')

  assert.equal(rateLimited.category, 'rate_limit_error')
  assert.equal(timedOut.category, 'timeout_error')
  assert.equal(rateLimited.userMessage, 'AI service temporarily unavailable; please retry.')
  assert.equal(timedOut.userMessage, 'AI service temporarily unavailable; please retry.')
})
