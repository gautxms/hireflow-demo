const SUPPORTED_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022'

function normalizeModelList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const configuredAllowedModels = normalizeModelList(process.env.ANTHROPIC_ALLOWED_MODELS)

export const AI_MODEL_CONFIG = {
  provider: 'anthropic',
  defaultModel: process.env.ANTHROPIC_RESUME_MODEL || SUPPORTED_ANTHROPIC_MODEL,
  allowedModels: configuredAllowedModels.length > 0
    ? Array.from(new Set(configuredAllowedModels))
    : [process.env.ANTHROPIC_RESUME_MODEL || SUPPORTED_ANTHROPIC_MODEL],
}

export function isAllowedAnthropicModel(model) {
  const normalized = String(model || '').trim()
  if (!normalized) return false
  return AI_MODEL_CONFIG.allowedModels.includes(normalized)
}

export function getAnthropicModelWarnings(models = []) {
  const evaluated = []

  for (const entry of models) {
    const model = String(entry?.model || '').trim()
    if (!model) continue

    if (!isAllowedAnthropicModel(model)) {
      evaluated.push({
        source: entry?.source || 'unknown',
        keyLabel: entry?.keyLabel || null,
        model,
      })
    }
  }

  return evaluated
}
