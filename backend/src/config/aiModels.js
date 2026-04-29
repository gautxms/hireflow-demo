const MODEL_FORMAT_REGEX = /^[a-z0-9][a-z0-9._:-]{0,199}$/i

function normalizeModelList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)))
}

const ANTHROPIC_DEFAULT_MODEL = String(process.env.ANTHROPIC_RESUME_MODEL || '').trim() || 'claude-sonnet-4-20250514'
const OPENAI_DEFAULT_MODEL = String(process.env.OPENAI_RESUME_MODEL || '').trim() || 'gpt-4o-mini'

const ANTHROPIC_SEED_MODELS = unique([
  ...normalizeModelList(process.env.ANTHROPIC_ALLOWED_MODELS),
  ANTHROPIC_DEFAULT_MODEL,
])

const OPENAI_SEED_MODELS = unique([
  ...normalizeModelList(process.env.OPENAI_ALLOWED_MODELS),
  OPENAI_DEFAULT_MODEL,
])

export const PROVIDER_MODEL_BOOTSTRAP = {
  anthropic: {
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    seedModels: ANTHROPIC_SEED_MODELS,
  },
  openai: {
    defaultModel: OPENAI_DEFAULT_MODEL,
    seedModels: OPENAI_SEED_MODELS,
  },
}

export const AI_MODEL_CONFIG = {
  provider: 'anthropic',
  defaultModel: PROVIDER_MODEL_BOOTSTRAP.anthropic.defaultModel,
  allowedModels: PROVIDER_MODEL_BOOTSTRAP.anthropic.seedModels,
}

export function isValidModelFormat(model) {
  const normalized = String(model || '').trim()
  if (!normalized) return false
  return MODEL_FORMAT_REGEX.test(normalized)
}
