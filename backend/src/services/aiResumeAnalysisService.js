import Anthropic from '@anthropic-ai/sdk'
import { logTelemetryToDatabase } from '../db/client.js'
import { getActiveAiProviderCredentials } from './aiProviderConfigService.js'
import { AI_MODEL_CONFIG } from '../config/aiModels.js'
import { getRuntimeSystemPromptConfig } from './adminSystemPromptService.js'

const MODEL = AI_MODEL_CONFIG.defaultModel
const MAX_MONTHLY_BUDGET = Number(process.env.CLAUDE_BUDGET_LIMIT || 100)
const MIME_TYPE_MAP = {
  'application/pdf': 'application/pdf',
}
const PROVIDER_ORDER = ['anthropic', 'openai']
const OPENAI_MODEL_CAPABILITIES = {
  default: {
    supportsTemperature: false,
  },
}
const OPENAI_OUTPUT_TOKEN_LADDER = [2000, 4000, 8000]

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

function sanitizeSnippet(value, maxLength = 180) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, maxLength)
}

function createProviderResponseFormatError({
  category = 'response_format_error',
  provider = null,
  model = null,
  technicalDetails = 'Provider returned malformed JSON output.',
}) {
  const serialized = JSON.stringify({
    technicalDetails: sanitizeSnippet(technicalDetails),
    provider: provider || null,
    model: model || null,
  })
  return new Error(`${category}::${serialized}`)
}

function buildPayloadKeySummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'payload_type=non_object'
  }
  return `keys=${Object.keys(payload).slice(0, 10).join(',') || 'none'}`
}

function findFirstJsonObjectBlock(text = '') {
  const input = String(text || '')
  const start = input.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < input.length; index += 1) {
    const char = input[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return input.slice(start, index + 1).trim()
      }
    }
  }
  return null
}

function isLikelyTruncatedResponse(text = '', { stopReason = null } = {}) {
  const normalizedStopReason = String(stopReason || '').toLowerCase()
  if (['max_tokens', 'length', 'model_context_window_exceeded'].includes(normalizedStopReason)) {
    return true
  }

  const trimmed = String(text || '').trim()
  if (!trimmed) return false
  const openBraces = (trimmed.match(/{/g) || []).length
  const closeBraces = (trimmed.match(/}/g) || []).length
  const openBrackets = (trimmed.match(/\[/g) || []).length
  const closeBrackets = (trimmed.match(/]/g) || []).length
  const hasUnclosedFence = trimmed.includes('```') && (trimmed.match(/```/g) || []).length % 2 === 1
  return openBraces > closeBraces || openBrackets > closeBrackets || hasUnclosedFence
}

export function safeParseAIResponse(rawResponse) {
  let text = String(rawResponse || '').trim()
  text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
  text = text.replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error('AI response JSON parse failed:', error)
    console.error('Raw response was:', rawResponse)
    throw new Error('AI returned invalid JSON')
  }
}

export function extractJsonWithContext(text = '', { provider = null, model = null } = {}) {
  const trimmed = String(text || '').trim()
  if (!trimmed) {
    throw createProviderResponseFormatError({
      provider,
      model,
      technicalDetails: 'Provider returned an empty response body.',
    })
  }

  const parseCandidates = []
  parseCandidates.push(trimmed)

  const fenceBodies = []
  const fencePattern = /```(?:[a-z0-9_-]+)?[ \t]*\n?([\s\S]*?)```/ig
  let fencedMatch = fencePattern.exec(trimmed)
  while (fencedMatch) {
    if (fencedMatch?.[1]) {
      fenceBodies.push(fencedMatch[1].trim())
    }
    fencedMatch = fencePattern.exec(trimmed)
  }

  const hasAnyFence = trimmed.includes('```')
  const hasClosedFence = fenceBodies.length > 0
  if (hasAnyFence && !hasClosedFence) {
    const lastFenceIndex = trimmed.lastIndexOf('```')
    const afterFence = trimmed.slice(lastFenceIndex + 3)
    const firstNewlineIndex = afterFence.indexOf('\n')
    const fencedBody = firstNewlineIndex === -1
      ? afterFence
      : afterFence.slice(firstNewlineIndex + 1)
    if (fencedBody.trim()) {
      fenceBodies.push(fencedBody.trim())
    }
  }
  parseCandidates.push(...fenceBodies)

  const firstObjectBlock = findFirstJsonObjectBlock(trimmed)
  if (firstObjectBlock) {
    parseCandidates.push(firstObjectBlock)
  }

  const uniqueCandidates = [...new Set(parseCandidates.filter(Boolean))]
  let lastError = null
  for (const candidate of uniqueCandidates) {
    try {
      return safeParseAIResponse(candidate)
    } catch (error) {
      lastError = error
    }
  }

  throw createProviderResponseFormatError({
    provider,
    model,
    technicalDetails: `Unable to parse provider JSON response (${sanitizeSnippet(lastError?.message || 'invalid_json')}). Snippet: ${sanitizeSnippet(trimmed)}`,
  })
}

function extractTextFromOpenAiContentNode(node) {
  if (!node || typeof node !== 'object') {
    return []
  }

  const chunks = []
  const directText = [node.output_text, node.text, node.value]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  chunks.push(...directText)

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      chunks.push(...extractTextFromOpenAiContentNode(child))
    }
  }

  return chunks
}

export function extractOpenAiResponseText(payload) {
  const directOutputText = String(payload?.output_text || '').trim()
  if (directOutputText) {
    return directOutputText
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : []
  const collectedText = []
  for (const outputNode of outputs) {
    collectedText.push(...extractTextFromOpenAiContentNode(outputNode))
  }

  return collectedText
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
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

  if (lower.includes('response_format_error')) {
    return format('response_format_error')
  }
  if (lower.includes('not_found_error') || lower.includes('model not found') || lower.includes('resource not found') || lower.includes('404')) {
    return format('not_found_error')
  }
  if (lower.includes('invalid_request_error') || lower.includes('invalid request') || lower.includes('unsupported model')) {
    return format('invalid_request_error')
  }
  if (lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('401')) {
    return format('auth_error')
  }
  if (
    lower.includes('insufficient_quota')
    || lower.includes('quota exceeded')
    || lower.includes('exceeded your current quota')
    || lower.includes('billing')
    || lower.includes('check your plan and billing details')
  ) {
    return format('billing_quota_error')
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
  failureCategory = null,
  failureReason = null,
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
    failureCategory,
    failureReason,
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

function getFailureCategory(message = '') {
  const normalized = String(message || '').trim()
  const match = normalized.match(/^(response_format_error|response_truncated_error|not_found_error|invalid_request_error|auth_error|billing_quota_error|rate_limit_error|timeout_error|network_error|unknown_error)(::|$)/i)
  return match?.[1] ? String(match[1]).toLowerCase() : 'unknown_error'
}

function providerSupportsMimeType(provider, mimeType) {
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
  if (normalizedProvider === 'anthropic') {
    return ['application/pdf'].includes(normalizedMimeType)
  }
  return true
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

function buildAnalysisModeDirectives(jobDescriptionContext = null) {
  const hasJobDescription = Boolean(jobDescriptionContext?.hasContext)

  if (hasJobDescription) {
    return [
      'Analysis Mode: WITH_JOB_DESCRIPTION',
      'Contract:',
      '- Perform resume extraction and JD-aware fit analysis.',
      '- Map candidate evidence to JD requirements and skills.',
      '- Include fit rationale and shortlisting signal strengths/risks in your JSON fields.',
      '- Keep output JSON-compatible with existing schema.',
    ].join('\n')
  }

  return [
    'Analysis Mode: WITHOUT_JOB_DESCRIPTION',
    'Contract:',
    '- Perform resume extraction only (no JD fit scoring assumptions).',
    '- Provide comparative shortlist signals derived from resume evidence (seniority, skills depth, impact, role alignment confidence).',
    '- Mark missing JD context clearly using "job_description_missing" in rationale/notes fields when present.',
    '- Keep output JSON-compatible with existing schema.',
  ].join('\n')
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

  const analysisModeDirectives = buildAnalysisModeDirectives(jdContext)

  return `${basePrompt}\n\n${analysisModeDirectives}\n\nResume-to-Job matching directives:\n1) If Job Description context is available below, evaluate candidate-job fit and include JD-aware scoring/rationale in your JSON fields where relevant.\n2) If Job Description context is missing, continue normal resume parsing and include an explicit reason marker "job_description_missing" in candidate rationale/notes fields when present.\n\nJob Description Context:\n${hasJobDescription ? 'AVAILABLE' : 'MISSING'}\n${jdSummary}`
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
    anthropicClientFactory = null,
  } = {},
) {
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Claude analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const client = anthropicClientFactory
    ? anthropicClientFactory({ apiKey })
    : new Anthropic({ apiKey })

  const prompt = buildPromptWithJobDescription(systemPromptConfig?.systemPrompt, jobDescriptionContext)
  const promptVersion = systemPromptConfig?.promptVersion || 1
  const promptIsDefaultFallback = Boolean(systemPromptConfig?.isDefaultFallback)
  console.log(
    '[HireFlow] JD in AI user message:',
    prompt.includes('Job Description Context:\nAVAILABLE') ? 'YES' : 'NO — JD missing from prompt',
  )

  const response = await client.messages.create({
    model,
    max_tokens: 2800,
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
    throw createProviderResponseFormatError({
      provider: 'anthropic',
      model,
      technicalDetails: `Unexpected Anthropic response format (${buildPayloadKeySummary(response)})`,
    })
  }

  let result = null
  try {
    console.log('[AI][Anthropic] Raw response before parsing:', textContent.text)
    result = extractJsonWithContext(textContent.text, { provider: 'anthropic', model })
  } catch (error) {
    const parseFailed = String(error?.message || '').includes('response_format_error::')
    if (!parseFailed) {
      throw error
    }

    if (isLikelyTruncatedResponse(textContent.text, { stopReason: response?.stop_reason })) {
      throw createProviderResponseFormatError({
        category: 'response_truncated_error',
        provider: 'anthropic',
        model,
        technicalDetails: `Provider output was truncated before valid JSON completion (stop_reason=${sanitizeSnippet(response?.stop_reason || 'unknown')}).`,
      })
    }

    const repaired = await client.messages.create({
      model,
      max_tokens: 1400,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'The previous response was not valid JSON.',
                'Return the same content as strict valid JSON only, no markdown.',
                'Do not include any explanation text.',
                'Previous response:',
                textContent.text,
              ].join('\n'),
            },
          ],
        },
      ],
    })
    const repairedText = (repaired.content || []).find((item) => item.type === 'text')?.text || ''
    try {
      console.log('[AI][Anthropic] Raw repaired response before parsing:', repairedText)
      result = extractJsonWithContext(repairedText, { provider: 'anthropic', model })
    } catch {
      throw createProviderResponseFormatError({
        provider: 'anthropic',
        model,
        technicalDetails: 'Unable to parse provider JSON after repair retry.',
      })
    }
  }

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
    modelCapabilities = null,
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. OpenAI analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const prompt = buildPromptWithJobDescription(systemPromptConfig?.systemPrompt, jobDescriptionContext)
  const promptVersion = systemPromptConfig?.promptVersion || 1
  const promptIsDefaultFallback = Boolean(systemPromptConfig?.isDefaultFallback)
  console.log(
    '[HireFlow] JD in AI user message:',
    prompt.includes('Job Description Context:\nAVAILABLE') ? 'YES' : 'NO — JD missing from prompt',
  )

  const effectiveModelCapabilities = modelCapabilities && typeof modelCapabilities === 'object'
    ? modelCapabilities
    : OPENAI_MODEL_CAPABILITIES.default

  const buildRequestBody = (maxOutputTokens) => {
    const requestBody = {
      model,
      max_output_tokens: maxOutputTokens,
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
    }

    if (effectiveModelCapabilities.supportsTemperature === true) {
      requestBody.temperature = 0
    }
    return requestBody
  }

  const callOpenAi = async (maxOutputTokens) => {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(maxOutputTokens)),
    })

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const message = errorPayload?.error?.message || `OpenAI request failed with status ${response.status}`
      throw new Error(message)
    }

    const payload = await response.json()
    if (payload?.error?.message) {
      throw new Error(String(payload.error.message))
    }

    return payload
  }

  let payload = null
  let responseStatus = ''
  let incompleteReason = ''
  for (const maxOutputTokens of OPENAI_OUTPUT_TOKEN_LADDER) {
    payload = await callOpenAi(maxOutputTokens)
    responseStatus = String(payload?.status || '').toLowerCase()
    incompleteReason = String(payload?.incomplete_details?.reason || '').trim()

    const shouldRetryForTokenCeiling = responseStatus === 'incomplete' && incompleteReason.toLowerCase() === 'max_output_tokens'
    if (shouldRetryForTokenCeiling) {
      continue
    }

    break
  }

  if (responseStatus && responseStatus !== 'completed') {
    if (incompleteReason.toLowerCase() === 'max_output_tokens') {
      throw createProviderResponseFormatError({
        category: 'response_truncated_error',
        provider: 'openai',
        model,
        technicalDetails: `Provider output was truncated before valid JSON completion after retries (status=${sanitizeSnippet(responseStatus)}, reason=${sanitizeSnippet(incompleteReason)}, max_output_tokens_attempted=${OPENAI_OUTPUT_TOKEN_LADDER.join('->')}).`,
      })
    }

    throw new Error(`OpenAI response status was ${responseStatus}${incompleteReason ? ` (${incompleteReason})` : ''}`)
  }

  const outputText = extractOpenAiResponseText(payload)
  if (!outputText) {
    throw createProviderResponseFormatError({
      provider: 'openai',
      model,
      technicalDetails: `Unexpected OpenAI response format (${buildPayloadKeySummary(payload)})`,
    })
  }

  console.log('[AI][OpenAI] Raw response before parsing:', outputText)
  const result = extractJsonWithContext(outputText, { provider: 'openai', model })
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
    if (!providerSupportsMimeType(entry.provider, mimeType)) {
      console.log(`[AI Parse] Skipping ${entry.provider}:${entry.keyLabel} for mime type ${mimeType}.`)
      continue
    }

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
      const normalizedMessage = normalizeProviderError(error, attemptHistory)
      const failureCategory = getFailureCategory(normalizedMessage)
      const failureReason = sanitizeSnippet(String(error?.message || 'unknown_error'), 220)
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
          unavailableReason: `provider_request_failed:${failureCategory}:${failureReason}`,
        },
        failureCategory,
        failureReason,
      }))
      if (failureCategory === 'billing_quota_error') {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} quota/billing failed; immediate failover.`, error.message)
      } else if (failureCategory === 'response_format_error') {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} response format failed after repair retry; failing over.`, error.message)
      } else {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} failed:`, error.message)
      }
    }
  }

  throw createTerminalProviderError(lastError, attemptHistory)
}

export const analyzeResumeWithClaude = analyzeWithAnthropic
