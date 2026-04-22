import test from 'node:test'
import assert from 'node:assert/strict'
import { mapProviderError } from './aiProviderErrorMapping.js'

test('mapProviderError maps invalid request errors to admin security guidance', () => {
  const result = mapProviderError('invalid_request_error: model is not allowed')

  assert.equal(result.category, 'invalid_request_error')
  assert.equal(result.userMessage, 'The configured AI model is invalid or no longer supported.')
  assert.equal(result.technicalDetails, 'invalid_request_error: model is not allowed')
  assert.equal(result.actionHint, 'Go to Admin Security')
  assert.equal(result.adminPath, '/admin/security')
})

test('mapProviderError maps invalid api key errors to key guidance', () => {
  const result = mapProviderError('Authentication failed due to invalid API key')

  assert.equal(result.category, 'auth_error')
  assert.equal(result.userMessage, 'The AI provider API key is invalid or expired.')
  assert.equal(result.remediationSteps.length > 0, true)
})

test('mapProviderError maps timeouts to retry guidance', () => {
  const result = mapProviderError('Request timed out while contacting provider')

  assert.equal(result.category, 'timeout_error')
  assert.equal(result.userMessage, 'The AI provider timed out while processing this request.')
})

test('mapProviderError maps provider rate limits to retry guidance', () => {
  const result = mapProviderError('rate_limit_error::provider returned 429')

  assert.equal(result.category, 'rate_limit_error')
  assert.equal(result.userMessage, 'The AI provider is rate-limiting requests right now.')
  assert.equal(result.technicalDetails, 'provider returned 429')
})

test('mapProviderError parses structured backend context for retired model guidance', () => {
  const result = mapProviderError('not_found_error::{"technicalDetails":"Model claude-2.0 retired","provider":"anthropic","model":"claude-2.0","adminPath":"/admin/security","action":"review_model_configuration","remediationSteps":["Replace retired model","Save settings","Retry"]}')

  assert.equal(result.category, 'not_found_error')
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.model, 'claude-2.0')
  assert.equal(result.remediationSteps[0], 'Replace retired model')
  assert.equal(result.actionHint, 'Go to Admin Security')
})
