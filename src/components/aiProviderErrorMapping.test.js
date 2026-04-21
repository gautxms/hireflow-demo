import test from 'node:test'
import assert from 'node:assert/strict'
import { mapProviderError } from './aiProviderErrorMapping.js'

test('mapProviderError maps invalid request errors to admin security guidance', () => {
  const result = mapProviderError('invalid_request_error: model is not allowed')

  assert.equal(result.category, 'invalid_request_error')
  assert.equal(result.userMessage, 'AI model configuration issue in Admin Security.')
  assert.equal(result.technicalDetails, 'invalid_request_error: model is not allowed')
})

test('mapProviderError maps auth errors to key guidance', () => {
  const result = mapProviderError('Authentication failed due to invalid API key')

  assert.equal(result.category, 'auth_error')
  assert.equal(result.userMessage, 'AI key invalid or expired.')
})

test('mapProviderError maps network/timeouts to retry guidance', () => {
  const result = mapProviderError('Request timed out while contacting provider')

  assert.equal(result.category, 'timeout_error')
  assert.equal(result.userMessage, 'AI service temporarily unavailable; please retry.')
})

test('mapProviderError parses normalized backend category prefix', () => {
  const result = mapProviderError('rate_limit_error::provider returned 429')

  assert.equal(result.category, 'rate_limit_error')
  assert.equal(result.userMessage, 'AI service temporarily unavailable; please retry.')
  assert.equal(result.technicalDetails, 'provider returned 429')
})
