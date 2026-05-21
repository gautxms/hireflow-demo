import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeResumeWithConfiguredFallback } from './aiResumeAnalysisService.js'

const FIXTURE_B64 = Buffer.from('resume text', 'utf8').toString('base64')

function buildCredentials() {
  return {
    activeProvider: 'anthropic',
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
    providers: {
      anthropic: {
        primary: { apiKey: 'k1', model: 'm1', source: 'test' },
      },
      openai: {
        primary: { apiKey: 'k2', model: 'm2', source: 'test' },
      },
    },
  }
}

function ok(provider, model) {
  return {
    provider,
    model,
    promptVersion: 1,
    promptIsDefaultFallback: false,
    tokenUsage: { usageAvailable: false },
    tokenBudgetAttempts: [],
    result: { candidates: [] },
  }
}

test('primary succeeds; fallback is not called', async () => {
  let fallbackCalls = 0
  const result = await analyzeResumeWithConfiguredFallback(FIXTURE_B64, 'application/pdf', 'r.txt', {
    credentials: buildCredentials(),
    systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
    analyzeWithAnthropic: async () => ok('anthropic-primary', 'm1'),
    analyzeWithOpenAI: async () => {
      fallbackCalls += 1
      return ok('openai-primary', 'm2')
    },
  })

  assert.equal(result.attempts.length, 1)
  assert.equal(fallbackCalls, 0)
})

test('same normalized reason between primary and fallback stops without second primary', async () => {
  let primaryCalls = 0
  let fallbackCalls = 0
  await assert.rejects(async () => analyzeResumeWithConfiguredFallback(FIXTURE_B64, 'application/pdf', 'r.txt', {
    credentials: buildCredentials(),
    systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
    analyzeWithAnthropic: async () => {
      primaryCalls += 1
      throw new Error('response_truncated_error::{"technicalDetails":"stop_reason=max_tokens"}')
    },
    analyzeWithOpenAI: async () => {
      fallbackCalls += 1
      throw new Error('response_truncated_error::{"technicalDetails":"incomplete_details.max_output_tokens"}')
    },
  }))

  assert.equal(primaryCalls, 1)
  assert.equal(fallbackCalls, 1)
})

test('different normalized reasons triggers one final primary retry', async () => {
  let primaryCalls = 0
  await assert.rejects(async () => analyzeResumeWithConfiguredFallback(FIXTURE_B64, 'application/pdf', 'r.txt', {
    credentials: buildCredentials(),
    systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
    analyzeWithAnthropic: async () => {
      primaryCalls += 1
      throw new Error('response_truncated_error::truncated')
    },
    analyzeWithOpenAI: async () => {
      throw new Error('timeout_error::provider timeout')
    },
  }))

  assert.equal(primaryCalls, 2)
})
