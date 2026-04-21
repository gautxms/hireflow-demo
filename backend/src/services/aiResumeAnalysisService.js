import Anthropic from '@anthropic-ai/sdk'
import { logTelemetryToDatabase } from '../db/client.js'
import { getActiveAiProviderCredentials } from './aiProviderConfigService.js'
import { AI_MODEL_CONFIG } from '../config/aiModels.js'
import { getRuntimeResumeSystemPrompt } from './systemPromptService.js'

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

export async function analyzeResumeWithClaude(fileBufferBase64, mimeType, filename, {
  apiKey,
  model = MODEL,
  credentialLabel = 'primary',
  systemPrompt,
  promptVersion = 1,
} = {}) {
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Claude analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const client = new Anthropic({ apiKey })
  const prompt = String(systemPrompt || '').trim()

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
      promptVersion: Number(promptVersion || 1),
    }
  } catch (error) {
    console.error('[Claude] Analysis failed:', {
      error: error.message,
      file: filename,
    })
    throw error
  }
}

export async function analyzeResumeWithConfiguredFallback(fileBufferBase64, mimeType, filename) {
  const credentials = await getActiveAiProviderCredentials()
  const attempts = [credentials.primary, credentials.fallback].filter((entry) => entry?.apiKey)
  if (attempts.length === 0) {
    throw new Error('No configured AI API keys found. Configure primary/fallback keys in Admin Security.')
  }

  const promptSettings = await getRuntimeResumeSystemPrompt()

  let lastError = null
  const attemptHistory = []

  for (const entry of attempts) {
    try {
      const response = await analyzeResumeWithClaude(fileBufferBase64, mimeType, filename, {
        apiKey: entry.apiKey,
        model: entry.model || MODEL,
        credentialLabel: entry.keyLabel,
        systemPrompt: promptSettings.prompt,
        promptVersion: promptSettings.promptVersion,
      })

      return {
        ...response,
        providerSource: entry.source,
        promptVersion: promptSettings.promptVersion,
        promptSource: promptSettings.source,
        attempts: [
          ...attemptHistory,
          {
            success: true,
            provider: response.provider,
            model: response.model,
            credentialLabel: response.credentialLabel,
            providerSource: entry.source,
            promptVersion: promptSettings.promptVersion,
            promptSource: promptSettings.source,
            tokenUsage: response.tokenUsage,
          },
        ],
      }
    } catch (error) {
      lastError = error
      attemptHistory.push({
        success: false,
        provider: `anthropic-${entry.keyLabel}`,
        model: entry.model || MODEL,
        credentialLabel: entry.keyLabel,
        providerSource: entry.source,
        promptVersion: promptSettings.promptVersion,
        promptSource: promptSettings.source,
        tokenUsage: {
          usageAvailable: false,
          unavailableReason: `provider_request_failed:${String(error?.message || 'unknown').slice(0, 160)}`,
        },
      })
      console.warn(`[AI Parse] ${entry.keyLabel} key failed:`, error.message)
    }
  }

  if (lastError && attemptHistory.length > 0) {
    lastError.attempts = attemptHistory
    lastError.promptVersion = promptSettings.promptVersion
    lastError.promptSource = promptSettings.source
  }

  throw lastError || new Error('All configured AI providers failed.')
}
