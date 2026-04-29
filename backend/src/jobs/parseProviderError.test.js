import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProviderError } from './parseProviderError.js'

test('normalizeProviderError maps invalid request errors', () => {
  const result = normalizeProviderError('invalid_request_error: unsupported model')

  assert.equal(result.category, 'invalid_request_error')
  assert.equal(result.userMessage, 'AI model configuration issue in Admin Security.')
  assert.equal(result.action, 'review_model_configuration')
  assert.equal(result.adminPath, '/admin/security')
  assert.match(result.normalizedMessage, /^invalid_request_error::\{/)
})

test('normalizeProviderError maps invalid API key auth failures', () => {
  const result = normalizeProviderError(new Error('Unauthorized: invalid API key'))

  assert.equal(result.category, 'auth_error')
  assert.equal(result.userMessage, 'AI key invalid or expired.')
  assert.equal(result.action, 'rotate_provider_api_key')
  assert.equal(result.adminPath, '/admin/security')
})

test('normalizeProviderError maps provider throttling and timeouts to retry category', () => {
  const rateLimited = normalizeProviderError('Rate limit exceeded (429)')
  const timedOut = normalizeProviderError('Network timeout while connecting to provider')

  assert.equal(rateLimited.category, 'rate_limit_error')
  assert.equal(timedOut.category, 'timeout_error')
  assert.equal(rateLimited.userMessage, 'AI service temporarily unavailable; please retry.')
  assert.equal(timedOut.userMessage, 'AI service temporarily unavailable; please retry.')
  assert.equal(rateLimited.action, 'retry_or_failover_provider')
  assert.equal(timedOut.action, 'retry_or_failover_provider')
})

test('normalizeProviderError maps provider billing/quota failures to billing guidance', () => {
  const result = normalizeProviderError('insufficient_quota: You exceeded your current quota, please check your plan and billing details')

  assert.equal(result.category, 'billing_quota_error')
  assert.equal(result.userMessage, 'AI provider billing/quota issue; update credits or switch provider.')
  assert.equal(result.action, 'resolve_provider_billing_or_quota')
  assert.deepEqual(result.remediationSteps, [
    'Add credits or resolve billing for the active AI provider account.',
    'Change the active provider/model pair in Admin Security.',
    'Test fallback provider/key and retry the resume analysis.',
  ])
})

test('normalizeProviderError captures retired model provider/model context from attempt history', () => {
  const providerFailure = new Error('not_found_error::Model not found')
  providerFailure.attempts = [
    { success: false, provider: 'anthropic-primary', model: 'claude-2.0' },
  ]
  const result = normalizeProviderError(providerFailure)

  assert.equal(result.category, 'not_found_error')
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.model, 'claude-2.0')
  assert.equal(result.action, 'review_model_configuration')
})

test('normalizeProviderError preserves provider/model context for response format failures', () => {
  const providerFailure = new Error('response_format_error::{"technicalDetails":"Unexpected token ` in JSON","provider":"openai","model":"gpt-4o-mini"}')
  const result = normalizeProviderError(providerFailure)

  assert.equal(result.category, 'response_format_error')
  assert.equal(result.provider, 'openai')
  assert.equal(result.model, 'gpt-4o-mini')
  assert.equal(result.action, 'retry_or_adjust_provider_model')
  assert.match(result.normalizedMessage, /^response_format_error::\{/)
})


test('normalizeProviderError maps truncated provider outputs', () => {
  const result = normalizeProviderError('response_truncated_error::{"technicalDetails":"stop_reason=max_tokens"}')

  assert.equal(result.category, 'response_truncated_error')
  assert.equal(result.action, 'retry_or_adjust_provider_model')
})
