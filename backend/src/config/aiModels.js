const ACTIVE_ANTHROPIC_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
]

function normalizeModelList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const configuredAllowedModels = normalizeModelList(process.env.ANTHROPIC_ALLOWED_MODELS)
const envOverrideModel = String(process.env.ANTHROPIC_RESUME_MODEL || '').trim()
const fallbackAllowedModels = configuredAllowedModels.length > 0
  ? Array.from(new Set(configuredAllowedModels))
  : Array.from(new Set(ACTIVE_ANTHROPIC_MODELS))
const normalizedAllowedModels = fallbackAllowedModels.length > 0
  ? fallbackAllowedModels
  : [ACTIVE_ANTHROPIC_MODELS[0]]

export const AI_MODEL_CONFIG = {
  provider: 'anthropic',
  defaultModel: envOverrideModel || normalizedAllowedModels[0],
  allowedModels: normalizedAllowedModels,
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
