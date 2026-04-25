import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeResumeWithConfiguredFallback,
  analyzeWithAnthropic,
  analyzeWithOpenAI,
  buildPromptWithJobDescription,
  extractJsonWithContext,
  extractOpenAiResponseText,
} from './aiResumeAnalysisService.js'

test('buildPromptWithJobDescription includes AVAILABLE JD block when context exists', () => {
  const prompt = buildPromptWithJobDescription('Base prompt', {
    hasContext: true,
    jobDescriptionId: 'jd-100',
    title: 'Senior Backend Engineer',
    description: 'Build APIs',
    requirements: 'Node.js, PostgreSQL',
    skills: ['Node.js', 'PostgreSQL'],
    experienceYears: 5,
    location: 'Remote',
    source: 'manual_fields',
  })

  assert.equal(prompt.includes('Job Description Context:\nAVAILABLE'), true)
  assert.equal(prompt.includes('Job Description ID: jd-100'), true)
})

test('buildPromptWithJobDescription includes MISSING block and reason when no JD exists', () => {
  const prompt = buildPromptWithJobDescription('Base prompt', {
    hasContext: false,
    missingReason: 'job_description_missing',
  })

  assert.equal(prompt.includes('Job Description Context:\nMISSING'), true)
  assert.equal(prompt.includes('job_description_missing'), true)
})

test('buildPromptWithJobDescription uses explicit WITH_JOB_DESCRIPTION contract', () => {
  const prompt = buildPromptWithJobDescription('Base prompt', {
    hasContext: true,
    jobDescriptionId: 'jd-100',
    title: 'Senior Backend Engineer',
  })

  assert.equal(prompt.includes('Analysis Mode: WITH_JOB_DESCRIPTION'), true)
  assert.equal(prompt.includes('JD-aware fit analysis'), true)
})

test('buildPromptWithJobDescription uses explicit WITHOUT_JOB_DESCRIPTION contract', () => {
  const prompt = buildPromptWithJobDescription('Base prompt', {
    hasContext: false,
    missingReason: 'job_description_missing',
  })

  assert.equal(prompt.includes('Analysis Mode: WITHOUT_JOB_DESCRIPTION'), true)
  assert.equal(prompt.includes('comparative shortlist signals'), true)
})

test('provider/model + JD-mode matrix stays compatible with dynamic model values', async () => {
  const scenarios = [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', jdMode: 'with_jd' },
    { provider: 'anthropic', model: 'claude-unlisted-preview-9999', jdMode: 'without_jd' },
    { provider: 'openai', model: 'gpt-4o-mini', jdMode: 'with_jd' },
    { provider: 'openai', model: 'gpt-custom-unlisted-2026-04-22', jdMode: 'without_jd' },
  ]

  for (const scenario of scenarios) {
    const calls = []
    const jdContext = scenario.jdMode === 'with_jd'
      ? { hasContext: true, jobDescriptionId: 'jd-1', title: 'Platform Engineer' }
      : { hasContext: false, missingReason: 'job_description_missing' }

    const credentials = scenario.provider === 'anthropic'
      ? {
          activeProvider: 'anthropic',
          providers: {
            anthropic: {
              primary: { apiKey: 'anth-key', model: scenario.model, source: 'admin' },
            },
          },
          governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
        }
      : {
          activeProvider: 'openai',
          providers: {
            openai: {
              primary: { apiKey: 'oa-key', model: scenario.model, source: 'admin' },
            },
          },
          governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
        }

    const anthropicAdapter = async (_fileB64, _mime, _filename, options) => {
      calls.push({ provider: 'anthropic', options })
      return {
        result: { candidates: [{ id: 'cand-1' }] },
        tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        provider: 'anthropic-primary',
        model: options.model,
      }
    }
    const openAiAdapter = async (_fileB64, _mime, _filename, options) => {
      calls.push({ provider: 'openai', options })
      return {
        result: { candidates: [{ id: 'cand-1' }] },
        tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        provider: 'openai-primary',
        model: options.model,
      }
    }

    await analyzeResumeWithConfiguredFallback('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
      credentials,
      systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 3, isDefaultFallback: false },
      jobDescriptionContext: jdContext,
      analyzeWithAnthropic: anthropicAdapter,
      analyzeWithOpenAI: openAiAdapter,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].provider, scenario.provider)
    assert.equal(calls[0].options.model, scenario.model)
    assert.deepEqual(calls[0].options.jobDescriptionContext, jdContext)
  }
})

test('analyzeWithAnthropic embeds JD mode contract in request payload', async () => {
  let capturedPrompt = ''
  const anthropicClientFactory = () => ({
    messages: {
      create: async (payload) => {
        capturedPrompt = payload?.messages?.[0]?.content?.find((item) => item.type === 'text')?.text || ''
        return {
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '{"candidates":[{"id":"cand-1"}]}' }],
        }
      },
    },
  })

  await analyzeWithAnthropic('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'anth-key',
    model: 'claude-unlisted-preview-9999',
    systemPromptConfig: { systemPrompt: 'Base prompt' },
    jobDescriptionContext: { hasContext: false, missingReason: 'job_description_missing' },
    anthropicClientFactory,
  })

  assert.equal(capturedPrompt.includes('Analysis Mode: WITHOUT_JOB_DESCRIPTION'), true)
})


test('analyzeWithAnthropic sends document payload for pdf uploads', async () => {
  let capturedRequest = null
  const anthropicClientFactory = () => ({
    messages: {
      create: async (request) => {
        capturedRequest = request
        return {
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '{"candidates":[{"id":"cand-word"}]}' }],
        }
      },
    },
  })

  const response = await analyzeWithAnthropic('d29yayBleHBlcmllbmNlIHNraWxscw==', 'application/pdf', 'resume.pdf', {
    apiKey: 'anth-key',
    model: 'claude-sonnet-4',
    systemPromptConfig: { systemPrompt: 'Base prompt' },
    anthropicClientFactory,
  })

  assert.equal(response.result.candidates[0].id, 'cand-word')
  assert.equal(capturedRequest.messages[0].content[0].type, 'document')
  assert.equal(capturedRequest.messages[0].content[0].source.media_type, 'application/pdf')
})

test('analyzeWithOpenAI embeds JD mode contract in request payload', async () => {
  let capturedPrompt = ''
  let capturedBody = null
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body)
    capturedBody = body
    capturedPrompt = body?.input?.[0]?.content?.find((item) => item.type === 'input_text')?.text || ''
    return {
      ok: true,
      json: async () => ({
        output_text: '{"candidates":[{"id":"cand-1"}]}',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }
  }

  await analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'oa-key',
    model: 'gpt-custom-unlisted-2026-04-22',
    systemPromptConfig: { systemPrompt: 'Base prompt' },
    jobDescriptionContext: { hasContext: true, jobDescriptionId: 'jd-1', title: 'Platform Engineer' },
    fetchImpl,
  })

  assert.equal(capturedPrompt.includes('Analysis Mode: WITH_JOB_DESCRIPTION'), true)
  assert.equal(Object.hasOwn(capturedBody, 'temperature'), false)
})

test('analyzeWithOpenAI omits temperature for modern responses models', async () => {
  let capturedBody = null
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body)
    capturedBody = body
    if (Object.hasOwn(body, 'temperature')) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Unsupported parameter: 'temperature'" } }),
      }
    }
    return {
      ok: true,
      json: async () => ({ output_text: '{"candidates":[{"id":"cand-1"}]}' }),
    }
  }

  await analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'oa-key',
    model: 'gpt-4.1-mini',
    fetchImpl,
  })

  assert.equal(Object.hasOwn(capturedBody, 'temperature'), false)
})

test('analyzeWithOpenAI supports opt-in temperature via model capability flags', async () => {
  let capturedBody = null
  const fetchImpl = async (_url, request) => {
    capturedBody = JSON.parse(request.body)
    return {
      ok: true,
      json: async () => ({ output_text: '{"candidates":[{"id":"cand-1"}]}' }),
    }
  }

  await analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'oa-key',
    model: 'gpt-custom-preview',
    modelCapabilities: { supportsTemperature: true },
    fetchImpl,
  })

  assert.equal(capturedBody.temperature, 0)
})

test('extractJsonWithContext parses raw JSON', () => {
  const result = extractJsonWithContext('{"candidates":[{"id":"cand-1"}]}', { provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(Array.isArray(result.candidates), true)
})

test('extractJsonWithContext parses fenced JSON', () => {
  const result = extractJsonWithContext('```json\n{"candidates":[{"id":"cand-2"}]}\n```', { provider: 'anthropic', model: 'claude-sonnet-4' })
  assert.equal(result.candidates[0].id, 'cand-2')
})

test('extractJsonWithContext parses fenced JSON wrapped in provider text', () => {
  const payload = 'Absolutely — here is the parsed result.\n```json\n{"candidates":[{"id":"cand-2b"}]}\n```\nLet me know if you want a schema.'
  const result = extractJsonWithContext(payload, { provider: 'anthropic', model: 'claude-sonnet-4' })
  assert.equal(result.candidates[0].id, 'cand-2b')
})

test('extractJsonWithContext recovers malformed fence using braces', () => {
  const payload = 'Here is the result:\n```json\n{"candidates":[{"id":"cand-3"}]}\n'
  const result = extractJsonWithContext(payload, { provider: 'anthropic', model: 'claude-sonnet-4' })
  assert.equal(result.candidates[0].id, 'cand-3')
})

test('extractJsonWithContext recovers unclosed generic fence with language tag', () => {
  const payload = 'Result below:\n```javascript\n{"candidates":[{"id":"cand-3b"}]}'
  const result = extractJsonWithContext(payload, { provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(result.candidates[0].id, 'cand-3b')
})

test('extractJsonWithContext recovers when json is surrounded by extra text', () => {
  const payload = 'analysis-start {"candidates":[{"id":"cand-4"}],"confidence":0.9} analysis-end'
  const result = extractJsonWithContext(payload, { provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(result.candidates[0].id, 'cand-4')
})

test('extractJsonWithContext throws response_format_error for non-recoverable text', () => {
  assert.throws(
    () => extractJsonWithContext('No JSON provided in this response', { provider: 'openai', model: 'gpt-4o-mini' }),
    /response_format_error::/,
  )
})

test('extractJsonWithContext keeps strict failure for invalid json body', () => {
  const payload = '```json\n{"candidates":[{"id":"cand-bad",}]}\n```'
  assert.throws(
    () => extractJsonWithContext(payload, { provider: 'anthropic', model: 'claude-sonnet-4' }),
    /response_format_error::/,
  )
})


test('extractOpenAiResponseText falls back to output content text nodes', () => {
  const payload = {
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: '{"candidates":[{"id":"cand-alt-1"}]}' },
        ],
      },
    ],
  }

  const text = extractOpenAiResponseText(payload)
  assert.equal(text, '{"candidates":[{"id":"cand-alt-1"}]}')
})

test('analyzeWithOpenAI supports alternate response shapes without output_text', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      output: [
        {
          type: 'message',
          content: [
            { output_text: '{"candidates":[{"id":"cand-alt-2"}]}' },
          ],
        },
      ],
    }),
  })

  const response = await analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'oa-key',
    model: 'gpt-4.1-mini',
    fetchImpl,
  })

  assert.equal(response.result.candidates[0].id, 'cand-alt-2')
})

test('analyzeWithOpenAI surfaces provider status failures before parse fallback', async () => {
  await assert.rejects(
    () => analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
      apiKey: 'oa-key',
      model: 'gpt-5-nano-2025-08-07',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          id: 'resp_123',
          status: 'failed',
          error: { message: 'Model execution failed' },
        }),
      }),
    }),
    /Model execution failed/,
  )
})

test('analyzeWithOpenAI retries with higher max_output_tokens for incomplete responses', async () => {
  let callCount = 0
  const response = await analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'oa-key',
    model: 'gpt-5-nano-2025-08-07',
    fetchImpl: async (_url, request) => {
      callCount += 1
      const body = JSON.parse(request.body)
      if (callCount === 1) {
        assert.equal(body.max_output_tokens, 2000)
        return {
          ok: true,
          json: async () => ({
            id: 'resp_456',
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          }),
        }
      }

      assert.equal(body.max_output_tokens, 4000)
      return {
        ok: true,
        json: async () => ({
          id: 'resp_789',
          status: 'completed',
          output_text: '{"candidates":[{"id":"cand-openai-retry"}]}',
        }),
      }
    },
  })

  assert.equal(callCount, 2)
  assert.equal(response.result.candidates[0].id, 'cand-openai-retry')
})

test('analyzeWithOpenAI surfaces truncated error when all max_output_tokens retries are still incomplete', async () => {
  let callCount = 0
  await assert.rejects(
    () => analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
      apiKey: 'oa-key',
      model: 'gpt-5-nano-2025-08-07',
      fetchImpl: async (_url, request) => {
        callCount += 1
        const body = JSON.parse(request.body)
        assert.equal(body.max_output_tokens, [2000, 4000, 8000][callCount - 1])
        return {
          ok: true,
          json: async () => ({
            id: `resp_${callCount}`,
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          }),
        }
      },
    }),
    /response_truncated_error::/,
  )

  assert.equal(callCount, 3)
})

test('analyzeWithAnthropic categorizes truncated output failures', async () => {
  const anthropicClientFactory = () => ({
    messages: {
      create: async () => ({
        stop_reason: 'max_tokens',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: '{"candidates":[' }],
      }),
    },
  })

  await assert.rejects(
    () => analyzeWithAnthropic('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
      apiKey: 'anth-key',
      model: 'claude-sonnet-4',
      systemPromptConfig: { systemPrompt: 'Base prompt' },
      anthropicClientFactory,
    }),
    /response_truncated_error::/,
  )
})

test('analyzeWithAnthropic performs one JSON repair retry on parse failure', async () => {
  let callCount = 0
  const anthropicClientFactory = () => ({
    messages: {
      create: async () => {
        callCount += 1
        if (callCount === 1) {
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'text', text: '```json\n{"candidates":[{"id":"cand-r"}],}\n```' }],
          }
        }
        return {
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '{"candidates":[{"id":"cand-r"}]}' }],
        }
      },
    },
  })

  const response = await analyzeWithAnthropic('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'anth-key',
    model: 'claude-sonnet-4',
    systemPromptConfig: { systemPrompt: 'Base prompt' },
    anthropicClientFactory,
  })

  assert.equal(callCount, 2)
  assert.equal(response.result.candidates[0].id, 'cand-r')
})

test('analyzeResumeWithConfiguredFallback records failure categories for failover attempts', async () => {
  const credentials = {
    activeProvider: 'anthropic',
    providers: {
      anthropic: {
        primary: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
      },
      openai: {
        primary: { apiKey: 'oa-key', model: 'gpt-4.1-mini', source: 'admin' },
      },
    },
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
  }

  const response = await analyzeResumeWithConfiguredFallback('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    credentials,
    systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
    analyzeWithAnthropic: async () => {
      throw new Error('billing_quota_error::{"technicalDetails":"insufficient quota"}')
    },
    analyzeWithOpenAI: async () => ({
      result: { candidates: [{ id: 'cand-fallback' }] },
      provider: 'openai-primary',
      model: 'gpt-4.1-mini',
      tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
    }),
  })

  assert.equal(response.attempts[0].failureCategory, 'billing_quota_error')
  assert.equal(response.attempts[1].success, true)
})

test('analyzeResumeWithConfiguredFallback skips anthropic for docx mime types and falls back to openai', async () => {
  const credentials = {
    activeProvider: 'anthropic',
    providers: {
      anthropic: {
        primary: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
      },
      openai: {
        primary: { apiKey: 'oa-key', model: 'gpt-4.1-mini', source: 'admin' },
      },
    },
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
  }

  let anthropicCalled = false
  let openAiCalled = false
  const response = await analyzeResumeWithConfiguredFallback(
    'ZmFrZQ==',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'resume.docx',
    {
      credentials,
      systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
      analyzeWithAnthropic: async () => {
        anthropicCalled = true
        return {
          result: { candidates: [{ id: 'cand-anthropic-docx' }] },
          provider: 'anthropic-primary',
          model: 'claude-sonnet-4',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
      analyzeWithOpenAI: async () => {
        openAiCalled = true
        return {
          result: { candidates: [{ id: 'cand-openai' }] },
          provider: 'openai-primary',
          model: 'gpt-4.1-mini',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
    },
  )

  assert.equal(anthropicCalled, false)
  assert.equal(openAiCalled, true)
  assert.equal(response.result.candidates[0].id, 'cand-openai')
  assert.equal(response.attempts.length, 1)
  assert.equal(response.attempts[0].success, true)
  assert.equal(response.attempts[0].provider, 'openai-primary')
})
