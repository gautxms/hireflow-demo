import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeResumeWithConfiguredFallback, buildPromptWithJobDescription, buildProviderAttemptPlan } from './aiResumeAnalysisService.js'

const baseCredentials = {
  activeProvider: 'anthropic',
  providers: {
    anthropic: {
      primary: { apiKey: 'anthro-primary', model: 'claude-a', source: 'admin-console' },
      fallback: { apiKey: 'anthro-fallback', model: 'claude-b', source: 'admin-console' },
    },
    openai: {
      primary: { apiKey: 'openai-primary', model: 'gpt-a', source: 'admin-console' },
      fallback: { apiKey: 'openai-fallback', model: 'gpt-b', source: 'admin-console' },
    },
  },
}

test('buildProviderAttemptPlan orders active provider first then secondary provider', () => {
  const plan = buildProviderAttemptPlan(baseCredentials)
  assert.deepEqual(
    plan.map((entry) => `${entry.provider}:${entry.keyLabel}`),
    ['anthropic:primary', 'anthropic:fallback', 'openai:primary', 'openai:fallback'],
  )
})

test('analyzeResumeWithConfiguredFallback advances to next provider/model when not_found_error occurs', async () => {
  const calls = []
  const response = await analyzeResumeWithConfiguredFallback('dGVzdA==', 'application/pdf', 'resume.pdf', {
    credentials: baseCredentials,
    systemPromptConfig: { systemPrompt: 'test', promptVersion: 7, isDefaultFallback: false },
    analyzeWithAnthropic: async (_file, _mime, _name, opts) => {
      calls.push(`anthropic:${opts.keyLabel}`)
      throw new Error('not_found_error::Model not found')
    },
    analyzeWithOpenAI: async (_file, _mime, _name, opts) => {
      calls.push(`openai:${opts.keyLabel}`)
      return {
        result: { candidates: [{ id: '1' }] },
        tokenUsage: { usageAvailable: true, inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCostUsd: null },
        provider: `openai-${opts.keyLabel}`,
        model: opts.model,
        credentialLabel: opts.keyLabel,
        providerSource: opts.providerSource,
        promptVersion: 7,
        promptIsDefaultFallback: false,
      }
    },
  })

  assert.deepEqual(calls, ['anthropic:primary', 'anthropic:fallback', 'openai:primary'])
  assert.equal(response.provider, 'openai-primary')
  assert.equal(response.attempts.length, 3)
  assert.equal(response.attempts[0].success, false)
  assert.equal(response.attempts[2].success, true)
})

test('analyzeResumeWithConfiguredFallback attaches full attempt trail on terminal failure', async () => {
  await assert.rejects(
    () => analyzeResumeWithConfiguredFallback('dGVzdA==', 'application/pdf', 'resume.pdf', {
      credentials: baseCredentials,
      systemPromptConfig: { systemPrompt: 'test', promptVersion: 3, isDefaultFallback: true },
      analyzeWithAnthropic: async () => {
        throw new Error('not_found_error::anthropic model missing')
      },
      analyzeWithOpenAI: async () => {
        throw new Error('timeout while contacting openai')
      },
    }),
    (error) => {
      assert.match(error.message, /not_found_error|timeout_error|unknown_error/i)
      assert.equal(Array.isArray(error.attempts), true)
      assert.equal(error.attempts.length, 4)
      assert.equal(error.attempts[0].provider, 'anthropic-primary')
      assert.equal(error.attempts[3].provider, 'openai-fallback')
      return true
    },
  )
})

test('analyzeResumeWithConfiguredFallback blocks analysis when governance disables AI', async () => {
  await assert.rejects(
    () => analyzeResumeWithConfiguredFallback('dGVzdA==', 'application/pdf', 'resume.pdf', {
      credentials: {
        ...baseCredentials,
        governance: { aiEnabled: false, workflowToggles: { resumeAnalysisEnabled: true } },
      },
      systemPromptConfig: { systemPrompt: 'test', promptVersion: 1, isDefaultFallback: false },
    }),
    /ai_disabled_error/i,
  )
})

test('analyzeResumeWithConfiguredFallback forwards jobDescriptionContext to provider adapters', async () => {
  const jobDescriptionContext = {
    hasContext: true,
    jobDescriptionId: 'jd-1',
    title: 'Backend Engineer',
    description: 'Node.js and PostgreSQL role',
    skills: ['Node.js', 'PostgreSQL'],
    source: 'manual_fields',
  }
  const receivedContexts = []

  await analyzeResumeWithConfiguredFallback('dGVzdA==', 'application/pdf', 'resume.pdf', {
    credentials: baseCredentials,
    systemPromptConfig: { systemPrompt: 'test prompt', promptVersion: 2, isDefaultFallback: false },
    jobDescriptionContext,
    analyzeWithAnthropic: async (_file, _mime, _name, opts) => {
      receivedContexts.push(opts.jobDescriptionContext)
      return {
        result: { candidates: [{ id: '1' }] },
        tokenUsage: { usageAvailable: false, unavailableReason: 'provider_usage_missing' },
        provider: `anthropic-${opts.keyLabel}`,
        model: opts.model,
        credentialLabel: opts.keyLabel,
        providerSource: opts.providerSource,
        promptVersion: 2,
        promptIsDefaultFallback: false,
      }
    },
  })

  assert.equal(receivedContexts.length, 1)
  assert.deepEqual(receivedContexts[0], jobDescriptionContext)
})

test('buildPromptWithJobDescription includes fallback directive when JD context is missing', () => {
  const prompt = buildPromptWithJobDescription('base prompt', {
    hasContext: false,
    missingReason: 'job_description_missing',
  })

  assert.match(prompt, /Job Description Context:\nMISSING/)
  assert.match(prompt, /job_description_missing/)
})
