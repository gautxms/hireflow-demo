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

test('provider-start hook runs once across fallback and retry attempts', async () => {
  const providerStarts = []

  await assert.rejects(async () => analyzeResumeWithConfiguredFallback(
    FIXTURE_B64,
    'application/pdf',
    'r.txt',
    {
      credentials: buildCredentials(),
      systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
      onProviderAttemptStart: async (metadata) => {
        providerStarts.push(metadata)
      },
      analyzeWithAnthropic: async () => {
        throw new Error('response_truncated_error::truncated')
      },
      analyzeWithOpenAI: async () => {
        throw new Error('timeout_error::provider timeout')
      },
    },
  ))

  assert.equal(providerStarts.length, 1)
  assert.deepEqual(providerStarts[0], {
    provider: 'anthropic',
    model: 'm1',
    keyLabel: 'primary',
    role: 'primary',
    attemptNumber: 1,
  })
})


test('AI_MAX_PROVIDER_ATTEMPTS_PER_FILE=1 does not invoke fallback', async () => {
  const prev = process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE
  process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = '1'
  let primaryCalls = 0
  let fallbackCalls = 0
  try {
    await assert.rejects(async () => analyzeResumeWithConfiguredFallback(FIXTURE_B64, 'application/pdf', 'r.txt', {
      credentials: buildCredentials(),
      systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
      analyzeWithAnthropic: async () => {
        primaryCalls += 1
        throw new Error('timeout_error::primary failed')
      },
      analyzeWithOpenAI: async () => {
        fallbackCalls += 1
        throw new Error('timeout_error::fallback failed')
      },
    }))
  } finally {
    if (prev === undefined) delete process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE
    else process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = prev
  }

  assert.equal(primaryCalls, 1)
  assert.equal(fallbackCalls, 0)
})

test('secondary provider is attempted before final primary retry', async () => {
  const credentials = buildCredentials()
  credentials.providers.openai.fallback = { apiKey: 'k3', model: 'm3', source: 'test' }

  const callOrder = []
  await assert.rejects(async () => analyzeResumeWithConfiguredFallback(FIXTURE_B64, 'application/pdf', 'r.txt', {
    credentials,
    systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
    analyzeWithAnthropic: async (_b64, _mime, _name, opts) => {
      callOrder.push(`${opts.keyLabel}:anthropic`)
      throw new Error('response_truncated_error::truncated')
    },
    analyzeWithOpenAI: async (_b64, _mime, _name, opts) => {
      callOrder.push(`${opts.keyLabel}:openai`)
      throw new Error('timeout_error::openai failed')
    },
  }))

  assert.deepEqual(callOrder, [
    'primary:anthropic',
    'primary:openai',
    'fallback:openai',
    'primary:anthropic',
  ])
})

test('extracted_text can fall back to anthropic (text path) after openai primary failure', async () => {
  const credentials = {
    activeProvider: 'openai',
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
    providers: {
      openai: { primary: { apiKey: 'k2', model: 'm2', source: 'test' } },
      anthropic: { primary: { apiKey: 'k1', model: 'm1', source: 'test' } },
    },
  }
  let anthropicCalls = 0
  const result = await analyzeResumeWithConfiguredFallback(FIXTURE_B64, 'text/plain', 'resume.docx', {
    credentials,
    systemPromptConfig: { promptVersion: 1, isDefaultFallback: false },
    analyzeWithOpenAI: async () => {
      throw new Error('response_truncated_error::openai output truncated')
    },
    analyzeWithAnthropic: async () => {
      anthropicCalls += 1
      return ok('anthropic-primary', 'm1')
    },
  })

  assert.equal(anthropicCalls, 1)
  assert.equal(result.attempts[0].success, false)
  assert.equal(result.attempts[1].success, true)
})
