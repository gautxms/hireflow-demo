import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeResumeWithConfiguredFallback,
  analyzeWithAnthropic,
  analyzeWithOpenAI,
  buildPromptWithJobDescription,
  runAiScoringContractV2ShadowAnalysis,
  __testables,
  extractJsonWithContext,
  extractOpenAiResponseText,
} from './aiResumeAnalysisService.js'
import { buildPdfJsTextContentMockFromFixtures, buildSyntheticPdfResumeFixture } from './resumeFormatDiagnosticFixtures.js'
import { __resetPdfJsClientForTests, __setPdfJsClientForTests } from './pdfCanonicalExtractionService.js'

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



test('extractJsonWithContext logs safe parse diagnostics without raw response or PII', (t) => {
  const originalWarn = console.warn
  const originalEnv = process.env.AI_RAW_RESPONSE_DEBUG_LOGS
  const logs = []
  process.env.AI_RAW_RESPONSE_DEBUG_LOGS = 'false'
  console.warn = (...args) => logs.push(args)
  t.after(() => {
    console.warn = originalWarn
    if (originalEnv === undefined) delete process.env.AI_RAW_RESPONSE_DEBUG_LOGS
    else process.env.AI_RAW_RESPONSE_DEBUG_LOGS = originalEnv
  })

  const rawResponse = JSON.stringify({
    candidates: [{
      name: 'Private Candidate',
      email: 'private.candidate@example.com',
      phone: '555-010-9999',
      summary: 'Secret resume text about payroll modernization',
      recommendation: 'Do not log recommendation text',
      fit_assessment: {
        matched_requirements: ['Do not log matched raw requirement'],
        missing_requirements: ['Do not log missing raw requirement'],
        rationale: 'Do not log rationale text',
      },
    }],
    jd: 'Do not log raw JD text',
  }).replace(/}$/, ',}')

  assert.throws(
    () => extractJsonWithContext(rawResponse, {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      promptVersion: 7,
      maxOutputTokens: 2200,
      completionStatus: 'end_turn',
      stopReason: 'end_turn',
      retryMetadata: { attempt: 1, fallback: false },
      analysisId: 'analysis-safe-id',
      resumeId: 'resume-safe-id',
    }),
    /response_format_error::/,
  )

  assert.equal(logs.length, 1)
  assert.equal(logs[0][0], '[AI Parse] Provider JSON parse failed:')
  const diagnostics = logs[0][1]
  assert.equal(diagnostics.provider, 'anthropic')
  assert.equal(diagnostics.model, 'claude-sonnet-4')
  assert.equal(diagnostics.prompt_version, 7)
  assert.equal(diagnostics.response_char_count, rawResponse.length)
  assert.equal(diagnostics.parse_error_type, 'SyntaxError')
  assert.equal(diagnostics.parse_error_code, 'invalid_json')
  assert.equal(diagnostics.parse_error_message, 'invalid_json')
  assert.equal(diagnostics.completion_status, 'end_turn')
  assert.equal(diagnostics.max_output_tokens, 2200)
  assert.match(diagnostics.error_fingerprint, /^[a-f0-9]{16}$/)

  const serialized = JSON.stringify(logs)
  for (const forbidden of [
    rawResponse,
    'Private Candidate',
    'private.candidate@example.com',
    '555-010-9999',
    'Secret resume text',
    'Do not log raw JD text',
    'Do not log recommendation text',
    'Do not log matched raw requirement',
    'Do not log missing raw requirement',
    'Do not log rationale text',
    'Expected double-quoted property name',
    'Unexpected token',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `expected logs not to include ${forbidden}`)
  }
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
      model: 'gpt-5-mini-2026-01-15',
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
    model: 'gpt-5-mini-2026-01-15',
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
      model: 'gpt-5-mini-2026-01-15',
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
  let callCount = 0
  const anthropicClientFactory = () => ({
    messages: {
      create: async () => {
        callCount += 1
        return {
          stop_reason: 'max_tokens',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '{"candidates":[' }],
        }
      },
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

  assert.equal(callCount, 3)
})

test('analyzeWithAnthropic does not advance token ladder for malformed non-truncated JSON', async () => {
  let callCount = 0
  const anthropicClientFactory = () => ({
    messages: {
      create: async () => {
        callCount += 1
        return {
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '```json\n{"candidates":[{"id":"cand-r"}],}\n```' }],
        }
      },
    },
  })

  await assert.rejects(
    () => analyzeWithAnthropic('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
      apiKey: 'anth-key',
      model: 'claude-sonnet-4',
      systemPromptConfig: { systemPrompt: 'Base prompt' },
      anthropicClientFactory,
    }),
    /response_format_error::/,
  )

  assert.equal(callCount, 1)
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

test('analyzeResumeWithConfiguredFallback sends DOCX-derived text/plain payload to OpenAI', async () => {
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

  let capturedMime = null
  const response = await analyzeResumeWithConfiguredFallback(
    Buffer.from('Experienced backend engineer', 'utf8').toString('base64'),
    'text/plain',
    'resume.docx',
    {
      credentials,
      analyzeWithAnthropic: async () => {
        throw new Error('Anthropic should be skipped for text/plain resume parsing')
      },
      analyzeWithOpenAI: async (_fileB64, mimeType) => {
        capturedMime = mimeType
        return {
          result: { candidates: [{ id: 'cand-openai-text' }] },
          provider: 'openai-primary',
          model: 'gpt-4.1-mini',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
    },
  )

  assert.equal(capturedMime, 'text/plain')
  assert.equal(response.result.candidates[0].id, 'cand-openai-text')
  assert.equal(response.attempts[1].provider, 'openai-primary')
  assert.equal(response.attempts[1].inputDiagnostics.sourceFormat, 'unknown')
  assert.equal(response.attempts[1].inputDiagnostics.inputKind, 'extracted_text')
  assert.equal(response.attempts[1].inputDiagnostics.preparedMimeType, 'text/plain')
  assert.equal(response.attempts[1].inputDiagnostics.extractedTextCharCount, 'Experienced backend engineer'.length)
  assert.equal(typeof response.attempts[1].inputDiagnostics.normalizedTextFingerprint, 'string')
})


test('analyzeWithOpenAI preserves considerations when compact-normalizing', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        candidates: [{
          id: 'cand-1',
          considerations: ['Needs stronger system design depth'],
        }],
      }),
    }),
  })

  const response = await analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    apiKey: 'oa-key',
    model: 'gpt-4.1-mini',
    fetchImpl,
  })

  assert.deepEqual(response.result.candidates[0].considerations, ['Needs stronger system design depth'])
})

test('analyzeWithOpenAI throws when parsed candidates is not an array', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify({ candidates: { id: 'not-array' } }) }),
  })

  await assert.rejects(
    () => analyzeWithOpenAI('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
      apiKey: 'oa-key',
      model: 'gpt-4.1-mini',
      fetchImpl,
    }),
    /missing candidates array/,
  )
})


test('buildPromptWithJobDescription does not duplicate output contract directives', () => {
  const prompt = buildPromptWithJobDescription('Base prompt', { hasContext: true, jobDescriptionId: 'jd-100' })
  assert.equal(prompt.includes('Return compact JSON only.'), false)
})

test('analyzeResumeWithConfiguredFallback can disable fallback on truncation', async () => {
  process.env.AI_DISABLE_FALLBACK_ON_TRUNCATION = 'true'
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

  let openAiCalled = false
  await assert.rejects(() => analyzeResumeWithConfiguredFallback('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    credentials,
    systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
    analyzeWithAnthropic: async () => { throw new Error('response_truncated_error::{}') },
    analyzeWithOpenAI: async () => { openAiCalled = true; return { result: { candidates: [{ id: 'x' }] } } },
  }), /response_truncated_error::/)

  assert.equal(openAiCalled, false)
  delete process.env.AI_DISABLE_FALLBACK_ON_TRUNCATION
})



test('analyzeResumeWithConfiguredFallback uses configured OpenAI model defaults for compact+truncation-safe escalation', async () => {
  const credentials = {
    activeProvider: 'anthropic',
    providers: {
      anthropic: {
        primary: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
      },
      openai: {
        fallback: { apiKey: 'oa-key', model: 'gpt-5-mini-2026-01-15', source: 'admin' },
      },
    },
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
  }

  const openAiModes = []
  const response = await analyzeResumeWithConfiguredFallback('ZmFrZQ==', 'application/pdf', 'resume.pdf', {
    credentials,
    systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
    analyzeWithAnthropic: async () => {
      throw new Error('response_truncated_error::{"technicalDetails":"anthropic truncated"}')
    },
    analyzeWithOpenAI: async (_file, _mime, _name, options) => {
      openAiModes.push(options.compactMode ? 'COMPACT_FULL' : 'BARE_MINIMUM')
      if (options.compactMode) {
        throw new Error('response_truncated_error::{"technicalDetails":"compact truncated"}')
      }
      return {
        result: { candidates: [{ id: 'cand-openai-bare-minimum' }] },
        provider: 'openai-fallback',
        model: options.model,
        tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        mode: 'bare_minimum',
      }
    },
  })

  assert.equal(response.result.candidates[0].id, 'cand-openai-bare-minimum')
  assert.deepEqual(openAiModes, ['COMPACT_FULL', 'BARE_MINIMUM'])
  assert.equal(response.attempts.at(-1).provider, 'openai-fallback')
  assert.equal(response.attempts.at(-1).success, true)
})
test('analyzeResumeWithConfiguredFallback counts only executed attempts against cap', async () => {
  process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = '1'
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
  const response = await analyzeResumeWithConfiguredFallback('ZmFrZQ==', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'resume.docx', {
    credentials,
    systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
    analyzeWithAnthropic: async () => { anthropicCalled = true; throw new Error('anthropic should be skipped for DOCX') },
    analyzeWithOpenAI: async () => {
      openAiCalled = true
      return {
        result: { candidates: [{ id: 'cand-1' }] },
        tokenUsage: { usageAvailable: false },
        provider: 'openai-primary',
        model: 'gpt-4.1-mini',
        credentialLabel: 'primary',
        providerSource: 'admin',
        promptVersion: 2,
        promptIsDefaultFallback: false,
      }
    },
  })

  assert.equal(anthropicCalled, false)
  assert.equal(openAiCalled, true)
  assert.equal(response.attempts.length, 1)
  assert.equal(response.attempts[0].success, true)
  assert.equal(response.attempts[0].provider, 'openai-primary')
  delete process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE
})


test('PDF observe-only extraction does not alter scoring payload or create an extra AI call', async () => {
  const previous = {
    enabled: process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED,
    sampleRate: process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE,
    maxAttemptsPerFile: process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE,
  }
  process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED = 'true'
  process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE = '100'
  process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = '8'
  const fixture = buildSyntheticPdfResumeFixture()
  __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([fixture]))
  const credentials = {
    activeProvider: 'anthropic',
    providers: {
      anthropic: {
        primary: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
      },
    },
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
  }
  const calls = []
  try {
    const response = await analyzeResumeWithConfiguredFallback(fixture.buffer.toString('base64'), 'application/pdf', 'resume.pdf', {
      credentials,
      systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
      analyzeWithAnthropic: async (fileB64, mimeType, filename) => {
        calls.push({ fileB64, mimeType, filename })
        return {
          result: { candidates: [{ id: 'cand-pdf' }] },
          provider: 'anthropic-primary',
          model: 'claude-sonnet-4',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
      analyzeWithOpenAI: async () => {
        throw new Error('openai should not be called')
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].fileB64, fixture.buffer.toString('base64'))
    assert.equal(calls[0].mimeType, 'application/pdf')
    assert.equal(calls[0].filename, 'resume.pdf')
    assert.equal(response.attempts.length, 1)
    assert.equal(response.attempts[0].inputDiagnostics.preparedMimeType, 'application/pdf')
    assert.equal(response.attempts[0].inputDiagnostics.inputKind, 'pdf_binary')
    assert.equal(response.attempts[0].inputDiagnostics.inputMode, 'binary')
    assert.equal(response.attempts[0].inputDiagnostics.extractedTextCharCount, 0)
    assert.equal(response.attempts[0].inputDiagnostics.pdfCanonicalExtractionObserveOnly.success, true)
  } finally {
    if (previous.enabled === undefined) delete process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED
    else process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED = previous.enabled
    if (previous.sampleRate === undefined) delete process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE
    else process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE = previous.sampleRate
    if (previous.maxAttemptsPerFile === undefined) delete process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE
    else process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = previous.maxAttemptsPerFile
    __resetPdfJsClientForTests()
  }
})


test('PDF observe-only extraction runs once across provider fallback retries', async () => {
  const previous = {
    enabled: process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED,
    sampleRate: process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE,
    maxAttemptsPerFile: process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE,
  }
  process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED = 'true'
  process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE = '100'
  process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = '8'
  const fixture = buildSyntheticPdfResumeFixture({ id: 'retry-parser-once-pdf' })
  let parserCalls = 0
  const mock = buildPdfJsTextContentMockFromFixtures([fixture, fixture])
  __setPdfJsClientForTests({
    ...mock,
    getDocument(...args) {
      parserCalls += 1
      return mock.getDocument(...args)
    },
  })
  const credentials = {
    activeProvider: 'anthropic',
    providers: {
      anthropic: {
        primary: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
      },
      openai: {
        fallback: { apiKey: 'oa-key', model: 'gpt-5-mini-2026-01-15', source: 'admin' },
      },
    },
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
  }
  const providerCalls = []
  try {
    const response = await analyzeResumeWithConfiguredFallback(fixture.buffer.toString('base64'), 'application/pdf', 'resume.pdf', {
      credentials,
      systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
      analyzeWithAnthropic: async (fileB64, mimeType, filename) => {
        providerCalls.push({ provider: 'anthropic', fileB64, mimeType, filename })
        throw new Error('provider_timeout::synthetic primary timeout')
      },
      analyzeWithOpenAI: async (fileB64, mimeType, filename) => {
        providerCalls.push({ provider: 'openai', fileB64, mimeType, filename })
        return {
          result: { candidates: [{ id: 'cand-openai-retry' }] },
          provider: 'openai-fallback',
          model: 'gpt-5-mini-2026-01-15',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
    })

    assert.equal(parserCalls, 1)
    assert.deepEqual(providerCalls.map((call) => call.provider), ['anthropic', 'openai'])
    assert.equal(providerCalls[0].fileB64, fixture.buffer.toString('base64'))
    assert.equal(providerCalls[1].fileB64, fixture.buffer.toString('base64'))
    assert.equal(response.attempts.at(-1).success, true)
    assert.equal(response.attempts.at(-1).inputDiagnostics.preparedMimeType, 'application/pdf')
    assert.equal(response.attempts.at(-1).inputDiagnostics.inputKind, 'pdf_binary')
    assert.equal(response.attempts.at(-1).inputDiagnostics.inputMode, 'binary')
    assert.equal(response.attempts.at(-1).inputDiagnostics.extractedTextCharCount, 0)
    assert.equal(response.attempts.at(-1).inputDiagnostics.pdfCanonicalExtractionObserveOnly.success, true)
  } finally {
    if (previous.enabled === undefined) delete process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED
    else process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED = previous.enabled
    if (previous.sampleRate === undefined) delete process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE
    else process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE = previous.sampleRate
    if (previous.maxAttemptsPerFile === undefined) delete process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE
    else process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = previous.maxAttemptsPerFile
    __resetPdfJsClientForTests()
  }
})


test('PDF canonical text scoring experiment sends text/plain only once and reuses payload across fallback attempts', async () => {
  const previous = {
    scoringEnabled: process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED,
    scoringUsers: process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS,
    maxAttemptsPerFile: process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE,
  }
  process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED = 'true'
  process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS = '26'
  process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = '8'
  const fixture = buildSyntheticPdfResumeFixture({ id: 'scoring-parser-once-pdf' })
  let parserCalls = 0
  const mock = buildPdfJsTextContentMockFromFixtures([fixture, fixture])
  __setPdfJsClientForTests({
    ...mock,
    getDocument(...args) {
      parserCalls += 1
      return mock.getDocument(...args)
    },
  })
  const credentials = {
    activeProvider: 'openai',
    providers: {
      openai: {
        primary: { apiKey: 'oa-key', model: 'gpt-5-mini-2026-01-15', source: 'admin' },
      },
      anthropic: {
        fallback: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
      },
    },
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
  }
  const providerCalls = []
  try {
    const response = await analyzeResumeWithConfiguredFallback(fixture.buffer.toString('base64'), 'application/pdf', 'resume.pdf', {
      credentials,
      diagnosticsContext: { userId: '26', analysisId: 'analysis-scoring' },
      systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
      analyzeWithOpenAI: async (fileB64, mimeType, filename) => {
        providerCalls.push({ provider: 'openai', fileB64, mimeType, filename })
        throw new Error('provider_timeout::synthetic primary timeout')
      },
      analyzeWithAnthropic: async (fileB64, mimeType, filename) => {
        providerCalls.push({ provider: 'anthropic', fileB64, mimeType, filename })
        return {
          result: { candidates: [{ id: 'cand-pdf-text' }] },
          provider: 'anthropic-fallback',
          model: 'claude-sonnet-4',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
    })

    assert.equal(parserCalls, 1)
    assert.equal(providerCalls.length, 2)
    assert.deepEqual(providerCalls.map((call) => call.mimeType), ['text/plain', 'text/plain'])
    assert.notEqual(providerCalls[0].fileB64, fixture.buffer.toString('base64'))
    assert.equal(providerCalls[0].fileB64, providerCalls[1].fileB64)
    assert.equal(Buffer.from(providerCalls[0].fileB64, 'base64').toString('utf8').includes('synthetic candidate alpha'), true)
    assert.equal(response.attempts.at(-1).inputDiagnostics.preparedMimeType, 'text/plain')
    assert.equal(response.attempts.at(-1).inputDiagnostics.inputKind, 'extracted_text')
    assert.equal(response.attempts.at(-1).inputDiagnostics.extractionMethod, 'pdfjs_dist_canonical_text_scoring_experiment')
    assert.equal(response.attempts.at(-1).inputDiagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'canonical_text_selected')
  } finally {
    if (previous.scoringEnabled === undefined) delete process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED
    else process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED = previous.scoringEnabled
    if (previous.scoringUsers === undefined) delete process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS
    else process.env.PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS = previous.scoringUsers
    if (previous.maxAttemptsPerFile === undefined) delete process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE
    else process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE = previous.maxAttemptsPerFile
    __resetPdfJsClientForTests()
  }
})

test('buildPromptWithJobDescription keeps AI scoring contract v2 out of production prompt even when shadow is enabled and allowlisted', () => {
  const previousEnabled = process.env.AI_SCORING_CONTRACT_V2_SHADOW_ENABLED
  const previousUserAllowlist = process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS
  const previousAnalysisAllowlist = process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_ANALYSIS_IDS

  try {
    delete process.env.AI_SCORING_CONTRACT_V2_SHADOW_ENABLED
    delete process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS
    delete process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_ANALYSIS_IDS

    const defaultOffPrompt = buildPromptWithJobDescription('Base prompt', {
      hasContext: true,
      jobDescriptionId: 'jd-v2',
      title: 'Software Engineer',
      __aiScoringContractV2ShadowMetadata: { userId: 10, analysisId: 'analysis-v2' },
    })

    process.env.AI_SCORING_CONTRACT_V2_SHADOW_ENABLED = 'true'
    process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS = '10'
    process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_ANALYSIS_IDS = 'analysis-v2'

    const enabledAllowlistedPrompt = buildPromptWithJobDescription('Base prompt', {
      hasContext: true,
      jobDescriptionId: 'jd-v2',
      title: 'Software Engineer',
      __aiScoringContractV2ShadowMetadata: { userId: 10, analysisId: 'analysis-v2' },
    })

    for (const prompt of [defaultOffPrompt, enabledAllowlistedPrompt]) {
      assert.equal(prompt.includes('AI Scoring Contract v2'), false)
      assert.equal(prompt.includes('ai_scoring_contract_v2'), false)
      assert.equal(prompt.includes('skills_match_score 40%'), false)
      assert.equal(prompt.includes('relevant_experience_score 30%'), false)
      assert.equal(prompt.includes('education_relevance_score 15%'), false)
      assert.equal(prompt.includes('seniority_progression_score 15%'), false)
    }
    assert.equal(enabledAllowlistedPrompt, defaultOffPrompt)
  } finally {
    if (previousEnabled === undefined) delete process.env.AI_SCORING_CONTRACT_V2_SHADOW_ENABLED
    else process.env.AI_SCORING_CONTRACT_V2_SHADOW_ENABLED = previousEnabled
    if (previousUserAllowlist === undefined) delete process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS
    else process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS = previousUserAllowlist
    if (previousAnalysisAllowlist === undefined) delete process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_ANALYSIS_IDS
    else process.env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_ANALYSIS_IDS = previousAnalysisAllowlist
  }
})

test('separate shadow AI scoring contract v2 is default-off and allowlist-gated', async () => {
  let calls = 0
  const base = {
    resumeText: 'Node.js API resume text',
    jobDescriptionContext: { hasContext: true, title: 'Backend Engineer', requirements: 'Node.js' },
    userId: '7',
    analysisId: 'analysis-7',
    resumeId: 'resume-7',
    candidates: [{ id: 'candidate-1' }],
    providerCall: async () => { calls += 1; return { skills_match_score: 90 } },
    logger: { warn: () => {} },
  }

  assert.equal((await runAiScoringContractV2ShadowAnalysis({ ...base, env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'false' } })).attempted, false)
  assert.equal(calls, 0)
  assert.equal((await runAiScoringContractV2ShadowAnalysis({ ...base, env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'true', AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS: '99' } })).attempted, false)
  assert.equal(calls, 0)
})

test('separate shadow AI scoring contract v2 attaches normalized contract without changing visible scores', async () => {
  const candidate = { score: 88, matchScore: { score: 88 }, fit_assessment: { overall_fit_score: 88 } }
  const result = await runAiScoringContractV2ShadowAnalysis({
    resumeText: 'Node.js API resume text',
    jobDescriptionContext: { hasContext: true, title: 'Backend Engineer', requirements: 'Node.js' },
    userId: '7',
    analysisId: 'analysis-7',
    resumeId: 'resume-7',
    candidates: [candidate],
    env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'true', AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS: '7' },
    providerCall: async () => ({
      scoring_contract_version: 'ai_jd_fit_rubric_v2',
      skills_match_score: 55,
      relevant_experience_score: 55,
      education_relevance_score: 55,
      seniority_progression_score: 55,
      weighted_total_score: 55,
      score_confidence: 'medium',
      score_confidence_reason: 'Sufficient evidence.',
      scoring_anomalies: [],
      has_job_description_context: true,
    }),
    logger: { warn: () => {} },
  })

  candidate.ai_scoring_contract_v2 = result.contract
  assert.equal(candidate.score, 88)
  assert.equal(candidate.matchScore.score, 88)
  assert.equal(candidate.fit_assessment.overall_fit_score, 88)
  assert.equal(candidate.ai_scoring_contract_v2.weighted_total_score_recomputed, 55)
})


test('separate shadow AI scoring contract v2 corrects model JD-context false when app has JD context', async () => {
  const candidate = { score: 88, matchScore: { score: 88 }, fit_assessment: { overall_fit_score: 88 } }
  const result = await runAiScoringContractV2ShadowAnalysis({
    resumeText: 'Node.js API resume text',
    jobDescriptionContext: { hasContext: true, title: 'Backend Engineer', requirements: 'Node.js' },
    userId: '7',
    analysisId: 'analysis-7',
    resumeId: 'resume-7',
    candidates: [candidate],
    env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'true', AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS: '7' },
    providerCall: async () => ({
      scoring_contract_version: 'ai_jd_fit_rubric_v2',
      skills_match_score: 45,
      relevant_experience_score: 45,
      education_relevance_score: 45,
      seniority_progression_score: 45,
      weighted_total_score: 45,
      score_confidence: 'medium',
      score_confidence_reason: 'Sufficient evidence.',
      scoring_anomalies: [],
      has_job_description_context: false,
    }),
    logger: { warn: () => {} },
  })

  candidate.ai_scoring_contract_v2 = result.contract
  assert.equal(candidate.score, 88)
  assert.equal(candidate.matchScore.score, 88)
  assert.equal(candidate.fit_assessment.overall_fit_score, 88)
  assert.equal(candidate.ai_scoring_contract_v2.has_job_description_context, true)
  assert.equal(candidate.ai_scoring_contract_v2.scoring_anomalies.includes('has_job_description_context_corrected'), true)
})

test('separate shadow AI scoring contract v2 skips missing resume text without provider call', async () => {
  let providerCalls = 0
  const candidate = { score: 88, matchScore: { score: 88 }, fit_assessment: { overall_fit_score: 88 } }
  const result = await runAiScoringContractV2ShadowAnalysis({
    resumeText: '',
    jobDescriptionContext: { hasContext: true, title: 'Backend Engineer' },
    userId: '7',
    analysisId: 'analysis-7',
    resumeId: 'resume-7',
    candidates: [candidate],
    env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'true', AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS: '7' },
    providerCall: async () => { providerCalls += 1; throw new Error('should_not_call_provider') },
    logger: { warn: () => {} },
  })

  assert.equal(result.attempted, true)
  assert.equal(result.skipped, true)
  assert.equal(providerCalls, 0)
  assert.equal(result.contract.scoring_anomalies.includes('v2_shadow_missing_resume_text'), true)
  assert.equal(result.contract.has_job_description_context, true)
  assert.equal(candidate.score, 88)
  assert.equal(candidate.matchScore.score, 88)
  assert.equal(candidate.fit_assessment.overall_fit_score, 88)
})

test('separate shadow AI scoring contract v2 diagnoses binary PDF input without text safely', async () => {
  const logs = []
  let providerCalls = 0
  const result = await runAiScoringContractV2ShadowAnalysis({
    resumeText: '',
    jobDescriptionContext: { hasContext: true, title: 'Backend Engineer' },
    userId: '7',
    analysisId: 'analysis-7',
    resumeId: 'resume-7',
    candidates: [{ score: 88, matchScore: { score: 88 }, fit_assessment: { overall_fit_score: 88 } }],
    inputDiagnostics: { inputKind: 'pdf_binary', inputMode: 'binary', normalizedTextCharCount: 0, extractionMethod: 'pdf_binary_provider_input' },
    env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'true', AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS: '7' },
    providerCall: async () => { providerCalls += 1; throw new Error('should_not_call_provider') },
    logger: { warn: (...args) => logs.push(args) },
  })

  assert.equal(providerCalls, 0)
  assert.equal(result.contract.scoring_anomalies.includes('v2_shadow_skipped_binary_input_without_text'), true)
  assert.equal(JSON.stringify(logs).includes('pdf_binary_provider_input'), false)
  assert.equal(JSON.stringify(logs).includes('base64'), false)
})

test('separate shadow AI scoring contract v2 fails open with safe diagnostics', async () => {
  const logs = []
  const result = await runAiScoringContractV2ShadowAnalysis({
    resumeText: 'Jane Candidate jane@example.com private resume text',
    jobDescriptionContext: { hasContext: true, title: 'Backend Engineer', description: 'private JD' },
    userId: '7',
    analysisId: 'analysis-7',
    resumeId: 'resume-7',
    candidates: [{ score: 88 }],
    env: { AI_SCORING_CONTRACT_V2_SHADOW_ENABLED: 'true', AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS: '7' },
    providerCall: async () => { throw new Error('provider_error') },
    logger: { warn: (...args) => logs.push(args) },
  })

  assert.equal(result.attempted, true)
  assert.equal(result.contract, null)
  assert.equal(JSON.stringify(logs).includes('Jane Candidate'), false)
  assert.equal(JSON.stringify(logs).includes('jane@example.com'), false)
  assert.equal(JSON.stringify(logs).includes('private JD'), false)
})

test('normalizeAiScoringContractV2 returns null for missing object and safely normalizes valid scores', () => {
  const { normalizeAiScoringContractV2 } = __testables
  assert.equal(normalizeAiScoringContractV2(null), null)

  const normalized = normalizeAiScoringContractV2({
    scoring_contract_version: 'ai_jd_fit_rubric_v2',
    skills_match_score: 90,
    relevant_experience_score: 80,
    education_relevance_score: 70,
    seniority_progression_score: 60,
    weighted_total_score: 79.5,
    score_confidence: 'High',
    score_confidence_reason: 'Clear rubric evidence.',
    scoring_anomalies: [],
    has_job_description_context: true,
  })

  assert.equal(normalized.weighted_total_score_from_ai, 79.5)
  assert.equal(normalized.weighted_total_score_recomputed, 79.5)
  assert.equal(normalized.score_confidence, 'high')
  assert.deepEqual(normalized.scoring_anomalies, [])
})



test('AI scoring contract v2 shadow prompt contains below-minimum experience calibration instructions', () => {
  const { buildAiScoringContractV2SeparateShadowPrompt } = __testables
  const prompt = buildAiScoringContractV2SeparateShadowPrompt({
    resumeText: 'Synthetic resume with backend projects.',
    jobDescriptionContext: { hasContext: true, title: 'SDE', experienceYears: '2-5 years' },
  })

  assert.equal(prompt.includes('Experience-floor calibration'), true)
  assert.equal(prompt.includes('25-45'), true)
  assert.equal(prompt.includes('Education relevance must not overcompensate'), true)
  assert.equal(prompt.includes('Skills match alone must not lift weighted_total_score'), true)
})

test('normalizeAiScoringContractV2 calibrates below-minimum experience shadow totals without changing visible fields', () => {
  const { normalizeAiScoringContractV2 } = __testables
  const candidate = {
    score: 52,
    matchScore: { score: 52 },
    fit_assessment: { overall_fit_score: 52 },
    verdict: 'Maybe',
    years_experience: 1.6,
  }

  const normalized = normalizeAiScoringContractV2({
    skills_match_score: 78,
    relevant_experience_score: 70,
    education_relevance_score: 82,
    seniority_progression_score: 68,
    weighted_total_score: 74,
    score_confidence: 'medium',
  }, {
    hasJobDescriptionContext: true,
    jobDescriptionContext: { hasContext: true, experienceYears: '2-5 years' },
    candidate,
  })

  assert.equal(normalized.relevant_experience_score, 45)
  assert.equal(normalized.seniority_progression_score, 50)
  assert.equal(normalized.weighted_total_score_recomputed <= 55, true)
  assert.equal(normalized.scoring_anomalies.includes('below_minimum_experience_relevant_experience_capped'), true)
  assert.equal(candidate.score, 52)
  assert.equal(candidate.matchScore.score, 52)
  assert.equal(candidate.fit_assessment.overall_fit_score, 52)
  assert.equal(candidate.verdict, 'Maybe')
})

test('normalizeAiScoringContractV2 keeps strong aligned above-minimum shadow fixture high', () => {
  const { normalizeAiScoringContractV2 } = __testables
  const normalized = normalizeAiScoringContractV2({
    skills_match_score: 93,
    relevant_experience_score: 91,
    education_relevance_score: 86,
    seniority_progression_score: 88,
    weighted_total_score: 90.6,
    score_confidence: 'high',
  }, {
    hasJobDescriptionContext: true,
    jobDescriptionContext: { hasContext: true, experienceYears: '2-5 years' },
    candidate: { years_experience: 4.1 },
  })

  assert.equal(normalized.weighted_total_score_recomputed, 90.6)
  assert.equal(normalized.scoring_anomalies.some((code) => code.startsWith('below_minimum_experience')), false)
})

test('normalizeAiScoringContractV2 keeps frontend-leaning above-minimum shadow fixture moderate', () => {
  const { normalizeAiScoringContractV2 } = __testables
  const normalized = normalizeAiScoringContractV2({
    skills_match_score: 68,
    relevant_experience_score: 55,
    education_relevance_score: 70,
    seniority_progression_score: 48,
    weighted_total_score: 61.4,
    score_confidence: 'medium',
  }, {
    hasJobDescriptionContext: true,
    jobDescriptionContext: { hasContext: true, experienceYears: '2-5 years' },
    candidate: { years_experience: 2.8 },
  })

  assert.equal(normalized.weighted_total_score_recomputed, 61.4)
  assert.equal(normalized.scoring_anomalies.some((code) => code.startsWith('below_minimum_experience')), false)
})

test('normalizeAiScoringContractV2 does not silently convert 8.6/10 style values to 86/100', () => {
  const { normalizeAiScoringContractV2 } = __testables
  const normalized = normalizeAiScoringContractV2({
    skills_match_score: 8.6,
    relevant_experience_score: 8,
    education_relevance_score: 7,
    seniority_progression_score: 6,
    weighted_total_score: 8,
    score_confidence: 'medium',
  })

  assert.equal(normalized.skills_match_score, 8.6)
  assert.equal(normalized.weighted_total_score_recomputed, 7.8)
  assert.equal(normalized.scoring_anomalies.includes('weighted_total_mismatch'), false)
})

test('normalizeAiScoringContractV2 is idempotent for normalized weighted totals and internal anomalies', () => {
  const { normalizeAiScoringContractV2 } = __testables
  const once = normalizeAiScoringContractV2({
    skills_match_score: 90,
    relevant_experience_score: 80,
    education_relevance_score: 70,
    seniority_progression_score: 60,
    weighted_total_score: 95,
    scoring_anomalies: ['model supplied note'],
  })
  const twice = normalizeAiScoringContractV2(once)

  assert.equal(once.weighted_total_score_from_ai, 95)
  assert.equal(twice.weighted_total_score_from_ai, 95)
  assert.equal(once.weighted_total_score_recomputed, 79.5)
  assert.equal(twice.weighted_total_score_recomputed, 79.5)
  assert.deepEqual(twice.scoring_anomalies, once.scoring_anomalies)
  assert.deepEqual(twice.model_reported_anomalies, once.model_reported_anomalies)
})


test('normalizeAiScoringContractV2 clamps out-of-range scores, nulls non-numeric scores, and flags mismatched totals', () => {
  const { normalizeAiScoringContractV2 } = __testables
  const normalized = normalizeAiScoringContractV2({
    skills_match_score: 120,
    relevant_experience_score: 'not-a-number',
    education_relevance_score: -10,
    seniority_progression_score: 50,
    weighted_total_score: 95,
    score_confidence: 'certain',
    scoring_anomalies: ['model_reported_issue'],
  })

  assert.equal(normalized.skills_match_score, 100)
  assert.equal(normalized.relevant_experience_score, null)
  assert.equal(normalized.education_relevance_score, 0)
  assert.equal(normalized.weighted_total_score_recomputed, null)
  assert.equal(normalized.score_confidence, 'low')
  assert.equal(normalized.scoring_anomalies.includes('skills_match_score_out_of_range_clamped'), true)
  assert.equal(normalized.scoring_anomalies.includes('relevant_experience_score_non_numeric'), true)
  assert.equal(normalized.scoring_anomalies.includes('education_relevance_score_out_of_range_clamped'), true)
  assert.equal(normalized.scoring_anomalies.includes('model_reported_issue'), false)
  assert.deepEqual(normalized.model_reported_anomalies, ['model_reported_issue'])
})


test('normalizeCompactAnalysis adds safe missing v2 contract diagnostic without changing visible scores', () => {
  const { normalizeCompactAnalysis } = __testables
  const result = normalizeCompactAnalysis({
    candidates: [{
      score: 88,
      matchScore: { score: 88 },
      fit_assessment: { overall_fit_score: 88 },
    }],
  }, { aiScoringContractV2Expected: true })

  assert.equal(result.candidates[0].score, 88)
  assert.equal(result.candidates[0].matchScore.score, 88)
  assert.equal(result.candidates[0].fit_assessment.overall_fit_score, 88)
  assert.equal(result.candidates[0].ai_scoring_contract_v2.weighted_total_score_from_ai, null)
  assert.equal(result.candidates[0].ai_scoring_contract_v2.weighted_total_score_recomputed, null)
  assert.deepEqual(result.candidates[0].ai_scoring_contract_v2.scoring_anomalies, ['v2_missing_contract'])
  assert.deepEqual(result.candidates[0].ai_scoring_contract_v2.model_reported_anomalies, [])
  assert.equal(result.candidates[0].ai_scoring_contract_v2.has_job_description_context, true)
})

test('normalizeCompactAnalysis preserves ai_scoring_contract_v2 without replacing visible score', () => {
  const { normalizeCompactAnalysis } = __testables
  const result = normalizeCompactAnalysis({
    candidates: [{
      score: 88,
      matchScore: { score: 88 },
      fit_assessment: { overall_fit_score: 88 },
      ai_scoring_contract_v2: {
        skills_match_score: 55,
        relevant_experience_score: 55,
        education_relevance_score: 55,
        seniority_progression_score: 55,
        weighted_total_score: 55,
      },
    }],
  })

  assert.equal(result.candidates[0].score, 88)
  assert.equal(result.candidates[0].matchScore.score, 88)
  assert.equal(result.candidates[0].fit_assessment.overall_fit_score, 88)
  assert.equal(result.candidates[0].ai_scoring_contract_v2.weighted_total_score_recomputed, 55)
})
