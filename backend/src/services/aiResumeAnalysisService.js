import Anthropic from '@anthropic-ai/sdk'
import { logTelemetryToDatabase } from '../db/client.js'
import { getActiveAiProviderCredentials } from './aiProviderConfigService.js'
import { AI_MODEL_CONFIG } from '../config/aiModels.js'
import { getRuntimeSystemPromptConfig } from './adminSystemPromptService.js'

const MODEL = AI_MODEL_CONFIG.defaultModel
const MAX_MONTHLY_BUDGET = Number(process.env.CLAUDE_BUDGET_LIMIT || 100)
const MIME_TYPE_MAP = {
  'application/pdf': 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword': 'application/msword',
}
const PROVIDER_ORDER = ['anthropic', 'openai']

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
    throw new Error('Provider returned an empty response')
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

function normalizeUsageMetrics(usage, provider = 'anthropic') {
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

  const inputTokens = Number(usage.input_tokens ?? usage.input_tokens_total ?? usage.prompt_tokens ?? usage.inputTokens)
  const outputTokens = Number(usage.output_tokens ?? usage.output_tokens_total ?? usage.completion_tokens ?? usage.outputTokens)
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

  const estimatedCostUsd = provider === 'anthropic'
    ? (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015
    : null

  return {
    usageAvailable: true,
    unavailableReason: null,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatedCostUsd === null ? null : Number(estimatedCostUsd.toFixed(6)),
  }
}

function extractProviderAndModelContext(message, attemptHistory = []) {
  const recentFailure = [...attemptHistory].reverse().find((attempt) => attempt && !attempt.success)
  if (recentFailure) {
    const providerLabel = String(recentFailure.provider || '').trim()
    const provider = providerLabel.includes('-') ? providerLabel.split('-')[0] : providerLabel || null
    return {
      provider,
      model: String(recentFailure.model || '').trim() || null,
    }
  }

  const lower = String(message || '').toLowerCase()
  const provider = lower.includes('anthropic')
    ? 'anthropic'
    : lower.includes('openai')
      ? 'openai'
      : null
  const modelMatch = String(message || '').match(/model(?:\s+name)?(?:\s+is|\s*=|:)?\s*["']?([a-z0-9][a-z0-9._:-]+)["']?/i)
  return {
    provider,
    model: modelMatch?.[1] ? String(modelMatch[1]).trim() : null,
  }
}

function normalizeProviderError(error, attemptHistory = []) {
  const message = String(error?.message || 'Unknown provider error').trim()
  const lower = message.toLowerCase()
  const { provider, model } = extractProviderAndModelContext(message, attemptHistory)

  const format = (category) => `${category}::${JSON.stringify({ technicalDetails: message, provider, model })}`

  if (lower.includes('not_found_error') || lower.includes('model not found') || lower.includes('resource not found') || lower.includes('404')) {
    return format('not_found_error')
  }
  if (lower.includes('invalid_request_error') || lower.includes('invalid request') || lower.includes('unsupported model')) {
    return format('invalid_request_error')
  }
  if (lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('401')) {
    return format('auth_error')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return format('rate_limit_error')
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return format('timeout_error')
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnreset')) {
    return format('network_error')
  }

  return format('unknown_error')
}

function createAttemptRecord({
  success,
  provider,
  keyLabel,
  model,
  providerSource,
  promptVersion,
  promptIsDefaultFallback,
  tokenUsage,
}) {
  return {
    success: Boolean(success),
    provider: `${provider}-${keyLabel}`,
    model,
    credentialLabel: keyLabel,
    providerSource,
    promptVersion,
    promptIsDefaultFallback,
    tokenUsage,
  }
}

function createTerminalProviderError(lastError, attemptHistory) {
  const normalizedMessage = lastError
    ? normalizeProviderError(lastError, attemptHistory)
    : 'unknown_error::All configured AI providers failed.'
  const terminalError = new Error(normalizedMessage)
  terminalError.attempts = attemptHistory
  terminalError.cause = lastError || null
  return terminalError
}

export function buildProviderAttemptPlan(credentials = {}) {
  const activeProvider = String(credentials?.activeProvider || 'anthropic').trim().toLowerCase()
  const providers = credentials?.providers && typeof credentials.providers === 'object' ? credentials.providers : {}
  const secondaryProviders = PROVIDER_ORDER.filter((provider) => provider !== activeProvider)
  const orderedProviders = [activeProvider, ...secondaryProviders].filter((provider, index, list) => list.indexOf(provider) === index)

  const plan = []
  for (const provider of orderedProviders) {
    const providerConfig = providers?.[provider]
    if (!providerConfig || typeof providerConfig !== 'object') continue

    for (const keyLabel of ['primary', 'fallback']) {
      const candidate = providerConfig?.[keyLabel]
      if (!candidate?.apiKey) continue

      plan.push({
        provider,
        keyLabel,
        apiKey: candidate.apiKey,
        model: candidate.model || MODEL,
        source: candidate.source || 'unknown',
      })
    }
  }

  return plan
}

function normalizePrompt(value) {
  return String(value || '').trim()
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return null
  }
  const formatted = String(value).trim()
  return formatted || null
}

function formatArray(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const normalized = values
    .map((value) => formatScalar(value))
    .filter(Boolean)

  return normalized.length > 0 ? normalized.join(', ') : null
}

export function buildPromptWithJobDescription(systemPrompt, jobDescriptionContext = null) {
  const basePrompt = normalizePrompt(systemPrompt)
  const jdContext = jobDescriptionContext && typeof jobDescriptionContext === 'object'
    ? jobDescriptionContext
    : null

  const hasJobDescription = Boolean(jdContext?.hasContext)
  const jdSummary = hasJobDescription
    ? [
        `- Job Description ID: ${formatScalar(jdContext?.jobDescriptionId) || 'unknown'}`,
        `- Title: ${formatScalar(jdContext?.title) || 'Not provided'}`,
        `- Description: ${formatScalar(jdContext?.description) || 'Not provided'}`,
        `- Requirements: ${formatScalar(jdContext?.requirements) || 'Not provided'}`,
        `- Skills: ${formatArray(jdContext?.skills) || 'Not provided'}`,
        `- Experience Years: ${formatScalar(jdContext?.experienceYears) || 'Not provided'}`,
        `- Location: ${formatScalar(jdContext?.location) || 'Not provided'}`,
        `- Source: ${formatScalar(jdContext?.source) || 'manual_fields'}`,
      ].join('\n')
    : `- Missing reason: ${formatScalar(jdContext?.missingReason) || 'job_description_missing'}`

  return `${basePrompt}\n\nResume-to-Job matching directives:\n1) If Job Description context is available below, evaluate candidate-job fit and include JD-aware scoring/rationale in your JSON fields where relevant.\n2) If Job Description context is missing, continue normal resume parsing and include an explicit reason marker \"job_description_missing\" in candidate rationale/notes fields when present.\n\nJob Description Context:\n${hasJobDescription ? 'AVAILABLE' : 'MISSING'}\n${jdSummary}`
}

export async function analyzeWithAnthropic(
  fileBufferBase64,
  mimeType,
  filename,
  {
    apiKey,
    model = MODEL,
    keyLabel = 'primary',
    providerSource = 'unknown',
    systemPromptConfig = null,
    jobDescriptionContext = null,
  } = {},
) {
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Claude analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const client = new Anthropic({ apiKey })

  const prompt = buildPromptWithJobDescription(systemPromptConfig?.systemPrompt, jobDescriptionContext)
  const promptVersion = systemPromptConfig?.promptVersion || 1
  const promptIsDefaultFallback = Boolean(systemPromptConfig?.isDefaultFallback)

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

  const tokenUsage = normalizeUsageMetrics(response?.usage, 'anthropic')
  if (tokenUsage.usageAvailable) {
    await trackTokens(response.usage, filename)
  }

  const textContent = (response.content || []).find((item) => item.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Unexpected Anthropic response format')
  }

  const result = extractJson(textContent.text)
  if (!Array.isArray(result?.candidates)) {
    throw new Error('Anthropic response is missing candidates array')
  }

  return {
    result,
    tokenUsage,
    provider: `anthropic-${keyLabel}`,
    model,
    credentialLabel: keyLabel,
    providerSource,
    promptVersion,
    promptIsDefaultFallback,
  }
}

export async function analyzeWithOpenAI(
  fileBufferBase64,
  mimeType,
  _filename,
  {
    apiKey,
    model = 'gpt-4o-mini',
    keyLabel = 'primary',
    providerSource = 'unknown',
    systemPromptConfig = null,
    jobDescriptionContext = null,
  } = {},
) {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. OpenAI analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const prompt = buildPromptWithJobDescription(systemPromptConfig?.systemPrompt, jobDescriptionContext)
  const promptVersion = systemPromptConfig?.promptVersion || 1
  const promptIsDefaultFallback = Boolean(systemPromptConfig?.isDefaultFallback)

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_output_tokens: 2000,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: 'resume',
              file_data: `data:${mediaType};base64,${fileBufferBase64}`,
            },
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null)
    const message = errorPayload?.error?.message || `OpenAI request failed with status ${response.status}`
    throw new Error(message)
  }

  const payload = await response.json()
  const outputText = String(payload?.output_text || '').trim()
  if (!outputText) {
    throw new Error('Unexpected OpenAI response format')
  }

  const result = extractJson(outputText)
  if (!Array.isArray(result?.candidates)) {
    throw new Error('OpenAI response is missing candidates array')
  }

  return {
    result,
    tokenUsage: normalizeUsageMetrics(payload?.usage, 'openai'),
    provider: `openai-${keyLabel}`,
    model,
    credentialLabel: keyLabel,
    providerSource,
    promptVersion,
    promptIsDefaultFallback,
  }
}

export async function analyzeResumeWithConfiguredFallback(fileBufferBase64, mimeType, filename, options = {}) {
  const credentials = options.credentials || await getActiveAiProviderCredentials()
  const systemPromptConfig = options.systemPromptConfig || await getRuntimeSystemPromptConfig()
  const governance = credentials?.governance && typeof credentials.governance === 'object'
    ? credentials.governance
    : { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } }
  if (governance.aiEnabled === false || governance?.workflowToggles?.resumeAnalysisEnabled === false) {
    throw new Error('ai_disabled_error::AI resume analysis is disabled by admin governance policy.')
  }
  const adapters = {
    anthropic: options.analyzeWithAnthropic || analyzeWithAnthropic,
    openai: options.analyzeWithOpenAI || analyzeWithOpenAI,
  }
  const attemptPlan = buildProviderAttemptPlan(credentials)

  if (attemptPlan.length === 0) {
    throw new Error('No configured AI API keys found. Configure provider primary/fallback keys in Admin Security.')
  }

  let lastError = null
  const attemptHistory = []

  for (const entry of attemptPlan) {
    try {
      const adapter = adapters[entry.provider] || analyzeWithAnthropic
      const response = await adapter(fileBufferBase64, mimeType, filename, {
        apiKey: entry.apiKey,
        model: entry.model,
        keyLabel: entry.keyLabel,
        providerSource: entry.source,
        systemPromptConfig,
        jobDescriptionContext: options.jobDescriptionContext || null,
      })

      return {
        ...response,
        attempts: [
          ...attemptHistory,
          createAttemptRecord({
            success: true,
            provider: entry.provider,
            keyLabel: entry.keyLabel,
            model: response.model,
            providerSource: entry.source,
            promptVersion: response.promptVersion,
            promptIsDefaultFallback: response.promptIsDefaultFallback,
            tokenUsage: response.tokenUsage,
          }),
        ],
      }
    } catch (error) {
      lastError = error
      attemptHistory.push(createAttemptRecord({
        success: false,
        provider: entry.provider,
        keyLabel: entry.keyLabel,
        model: entry.model,
        providerSource: entry.source,
        promptVersion: systemPromptConfig?.promptVersion || 1,
        promptIsDefaultFallback: Boolean(systemPromptConfig?.isDefaultFallback),
        tokenUsage: {
          usageAvailable: false,
          unavailableReason: `provider_request_failed:${String(error?.message || 'unknown').slice(0, 160)}`,
        },
      }))
      console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} failed:`, error.message)
    }
  }

  throw createTerminalProviderError(lastError, attemptHistory)
}

export const analyzeResumeWithClaude = analyzeWithAnthropic
