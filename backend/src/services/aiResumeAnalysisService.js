import Anthropic from '@anthropic-ai/sdk'
import { logTelemetryToDatabase } from '../db/client.js'
import { buildProviderAttemptPlan, getActiveAiProviderCredentials } from './aiProviderConfigService.js'
import { AI_MODEL_CONFIG } from '../config/aiModels.js'

const MODEL = AI_MODEL_CONFIG.defaultModel
const MAX_MONTHLY_BUDGET = Number(process.env.CLAUDE_BUDGET_LIMIT || 100)
const MIME_TYPE_MAP = {
  'application/pdf': 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword': 'application/msword',
}

let claudeTokensUsed = {
  input: 0,
  output: 0,
  totalRequests: 0,
}

export function getClaudeTokenStats() {
  return claudeTokensUsed
}

export function resetClaudeTokenStats() {
  claudeTokensUsed = { input: 0, output: 0, totalRequests: 0 }
}

function extractJson(text = '') {
  const trimmed = String(text || '').trim()
  if (!trimmed) {
    throw new Error('Claude returned an empty response')
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const payload = fencedMatch ? fencedMatch[1].trim() : trimmed

  return JSON.parse(payload)
}

async function sendBudgetAlert({ currentCost, limit }) {
  await logTelemetryToDatabase('claude.budget.alert', {
    currentCost,
    limit,
    percentageUsed: limit > 0 ? Number(((currentCost / limit) * 100).toFixed(1)) : null,
    loggedAt: new Date().toISOString(),
  }).catch(() => {})
}

async function checkBudgetAlert(estimatedCost) {
  if (MAX_MONTHLY_BUDGET <= 0) {
    return
  }

  if (estimatedCost > MAX_MONTHLY_BUDGET * 0.8) {
    console.warn('[Claude] Budget approaching limit:', {
      estimated: estimatedCost,
      limit: MAX_MONTHLY_BUDGET,
      percentageUsed: ((estimatedCost / MAX_MONTHLY_BUDGET) * 100).toFixed(1),
    })

    await sendBudgetAlert({
      currentCost: estimatedCost,
      limit: MAX_MONTHLY_BUDGET,
    }).catch(() => {})
  }
}

async function trackTokens(usage = {}, resumeId = 'unknown') {
  claudeTokensUsed.input += usage.input_tokens || 0
  claudeTokensUsed.output += usage.output_tokens || 0
  claudeTokensUsed.totalRequests += 1

  const inputCost = ((usage.input_tokens || 0) / 1000) * 0.003
  const outputCost = ((usage.output_tokens || 0) / 1000) * 0.015
  const totalCost = inputCost + outputCost
  const totalCostThisSession = (claudeTokensUsed.input / 1000) * 0.003 + (claudeTokensUsed.output / 1000) * 0.015

  console.log('[Claude] Tokens:', {
    resumeId,
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    estimatedCost: `$${totalCost.toFixed(4)}`,
    totalCostThisSession: `$${totalCostThisSession.toFixed(4)}`,
  })

  await logTelemetryToDatabase('claude.token_usage', {
    resumeId,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    estimatedCost: totalCost,
    totalCostThisSession,
    loggedAt: new Date().toISOString(),
  }).catch(() => {})

  await checkBudgetAlert(totalCostThisSession)
}

function normalizeUsageMetrics(usage) {
  if (!usage) {
    return {
      usageAvailable: false,
      unavailableReason: 'provider_usage_missing',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    }
  }

  const inputTokens = Number(usage.input_tokens)
  const outputTokens = Number(usage.output_tokens)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return {
      usageAvailable: false,
      unavailableReason: 'provider_usage_invalid',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    }
  }

  const estimatedCostUsd = (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015

  return {
    usageAvailable: true,
    unavailableReason: null,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
  }
}

export async function analyzeResumeWithClaude(fileBufferBase64, mimeType, filename, { apiKey, model = MODEL, credentialLabel = 'primary' } = {}) {
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Claude analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const client = new Anthropic({ apiKey })

  const prompt = `Extract and analyze this resume. Return ONLY valid JSON (no markdown, no explanation):
{
  "candidates": [{
    "name": "string (required)",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "summary": "2-3 sentence professional summary",
    "skills": ["skill1", "skill2"],
    "experience": [{
      "title": "Job Title",
      "company": "Company",
      "duration": "X years or dates",
      "description": "Key accomplishments",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM"
    }],
    "education": [{
      "degree": "BS Computer Science",
      "school": "University",
      "graduation_year": 2020
    }],
    "certifications": ["cert1"],
    "languages": ["English"],
    "projects": [{
      "name": "Project",
      "description": "What built",
      "url": "link"
    }],
    "achievements": ["achievement1"],
    "confidence": {
      "name": 0.95,
      "email": 0.85,
      "skills": 0.88,
      "experience": 0.90
    }
  }]
}`

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: fileBufferBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    })

    const tokenUsage = normalizeUsageMetrics(response.usage)
    if (tokenUsage.usageAvailable) {
      await trackTokens(response.usage, filename)
    }

    const textContent = (response.content || []).find((item) => item.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Unexpected Claude response format')
    }

    const result = extractJson(textContent.text)
    if (!Array.isArray(result?.candidates)) {
      throw new Error('Claude response is missing candidates array')
    }

    return {
      result,
      tokenUsage,
      provider: `anthropic-${credentialLabel}`,
      model,
      credentialLabel,
    }
  } catch (error) {
    console.error('[Claude] Analysis failed:', {
      error: error.message,
      file: filename,
    })
    throw error
  }
}

function normalizeOpenAiUsageMetrics(usage) {
  if (!usage || typeof usage !== 'object') {
    return {
      usageAvailable: false,
      unavailableReason: 'provider_usage_missing',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    }
  }

  const inputTokens = Number(usage.prompt_tokens)
  const outputTokens = Number(usage.completion_tokens)
  const totalTokens = Number(usage.total_tokens)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return {
      usageAvailable: false,
      unavailableReason: 'provider_usage_invalid',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    }
  }

  return {
    usageAvailable: true,
    unavailableReason: null,
    inputTokens,
    outputTokens,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : inputTokens + outputTokens,
    estimatedCostUsd: null,
  }
}

export async function analyzeWithAnthropic(fileBufferBase64, mimeType, filename, options = {}) {
  return analyzeResumeWithClaude(fileBufferBase64, mimeType, filename, options)
}

export async function analyzeWithOpenAI(fileBufferBase64, mimeType, filename, { apiKey, model = 'gpt-4o-mini', credentialLabel = 'primary' } = {}) {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. OpenAI analysis unavailable.')
  }

  const prompt = `Extract and analyze this resume. Return ONLY valid JSON (no markdown, no explanation) in this shape:
{
  "candidates": [{
    "name": "string (required)",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "summary": "2-3 sentence professional summary",
    "skills": ["skill1", "skill2"],
    "experience": [{
      "title": "Job Title",
      "company": "Company",
      "duration": "X years or dates",
      "description": "Key accomplishments",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM"
    }],
    "education": [{
      "degree": "BS Computer Science",
      "school": "University",
      "graduation_year": 2020
    }],
    "certifications": ["cert1"],
    "languages": ["English"],
    "projects": [{
      "name": "Project",
      "description": "What built",
      "url": "link"
    }],
    "achievements": ["achievement1"],
    "confidence": {
      "name": 0.95,
      "email": 0.85,
      "skills": 0.88,
      "experience": 0.90
    }
  }]
}

Filename: ${filename}
Mime-Type: ${mimeType}
Resume payload (base64-encoded binary file): ${fileBufferBase64}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`openai_http_${response.status}: ${body || 'request_failed'}`)
  }

  const payload = await response.json()
  const messageContent = payload?.choices?.[0]?.message?.content
  if (!messageContent) {
    throw new Error('Unexpected OpenAI response format')
  }

  const result = extractJson(messageContent)
  if (!Array.isArray(result?.candidates)) {
    throw new Error('OpenAI response is missing candidates array')
  }

  return {
    result,
    tokenUsage: normalizeOpenAiUsageMetrics(payload?.usage),
    provider: `openai-${credentialLabel}`,
    model,
    credentialLabel,
  }
}

export async function analyzeResumeWithConfiguredFallback(fileBufferBase64, mimeType, filename) {
  const credentials = await getActiveAiProviderCredentials()
  const attempts = buildProviderAttemptPlan(credentials)
  if (attempts.length === 0) {
    throw new Error('No configured AI API keys found. Configure primary/fallback keys in Admin Security.')
  }

  let lastError = null
  const attemptHistory = []
  const adapters = {
    anthropic: analyzeWithAnthropic,
    openai: analyzeWithOpenAI,
  }

  for (const entry of attempts) {
    try {
      const analyze = adapters[entry.provider]
      if (!analyze) {
        throw new Error(`Unsupported provider: ${entry.provider}`)
      }

      const response = await analyze(fileBufferBase64, mimeType, filename, {
        apiKey: entry.apiKey,
        model: entry.model || MODEL,
        credentialLabel: entry.keyLabel,
      })

      return {
        ...response,
        providerSource: entry.source,
        attempts: [
          ...attemptHistory,
          {
            success: true,
            provider: response.provider,
            model: response.model,
            credentialLabel: response.credentialLabel,
            providerSource: entry.source,
            providerType: entry.provider,
            tokenUsage: response.tokenUsage,
          },
        ],
      }
    } catch (error) {
      lastError = error
      attemptHistory.push({
        success: false,
        provider: `${entry.provider}-${entry.keyLabel}`,
        model: entry.model || MODEL,
        credentialLabel: entry.keyLabel,
        providerSource: entry.source,
        providerType: entry.provider,
        tokenUsage: {
          usageAvailable: false,
          unavailableReason: `provider_request_failed:${String(error?.message || 'unknown').slice(0, 160)}`,
        },
      })
      console.warn(`[AI Parse] ${entry.provider}.${entry.keyLabel} failed:`, error.message)
    }
  }

  if (lastError && attemptHistory.length > 0) {
    lastError.attempts = attemptHistory
  }

  throw lastError || new Error('All configured AI providers failed.')
}
