import { pool } from '../db/client.js'
import { AI_MODEL_CONFIG, getAnthropicModelWarnings } from '../config/aiModels.js'

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai']
export const KEY_LABELS = ['primary', 'fallback']

const DEFAULT_PROVIDER = 'anthropic'
const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: AI_MODEL_CONFIG.defaultModel,
  openai: process.env.OPENAI_RESUME_MODEL || 'gpt-4.1-mini',
}

let tableEnsured = false

async function ensureAiProviderTable() {
  if (tableEnsured) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_provider_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      key_label TEXT NOT NULL CHECK (key_label IN ('primary', 'fallback')),
      api_key TEXT NOT NULL,
      model TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (provider, key_label)
    );
  `)

  tableEnsured = true
}

function getDefaultModel(provider) {
  return DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER[DEFAULT_PROVIDER]
}

function maskApiKey(apiKey) {
  const value = String(apiKey || '').trim()
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function buildProviderSettings(provider, rowsByProvider = []) {
  const byLabel = new Map(rowsByProvider.map((row) => [row.key_label, row]))
  const settings = {
    defaultModel: getDefaultModel(provider),
  }

  for (const label of KEY_LABELS) {
    const row = byLabel.get(label)
    settings[label] = {
      configured: Boolean(row?.api_key),
      maskedApiKey: maskApiKey(row?.api_key),
      model: row?.model || getDefaultModel(provider),
      isActive: row ? Boolean(row.is_active) : true,
      updatedAt: row?.updated_at || null,
    }
  }

  return settings
}

function normalizeLegacyPayload({ primaryApiKey, fallbackApiKey, primaryModel, fallbackModel }) {
  return {
    activeProvider: DEFAULT_PROVIDER,
    providers: {
      [DEFAULT_PROVIDER]: {
        primary: {
          apiKey: String(primaryApiKey || '').trim(),
          model: String(primaryModel || '').trim(),
        },
        fallback: {
          apiKey: String(fallbackApiKey || '').trim(),
          model: String(fallbackModel || '').trim(),
        },
      },
    },
  }
}

function normalizePayload(payload) {
  const candidate = payload && typeof payload === 'object' ? payload : null
  if (!candidate) {
    return { ok: false, error: 'Invalid ai-settings payload.' }
  }

  const providersPayload = candidate.providers && typeof candidate.providers === 'object'
    ? candidate.providers
    : {}

  const normalizedProviders = {}
  for (const provider of Object.keys(providersPayload)) {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return { ok: false, error: `Unsupported provider "${provider}".` }
    }

    const providerConfig = providersPayload[provider]
    if (!providerConfig || typeof providerConfig !== 'object') {
      return { ok: false, error: `Invalid configuration for provider "${provider}".` }
    }

    normalizedProviders[provider] = {}
    for (const label of KEY_LABELS) {
      const labelConfig = providerConfig[label]
      normalizedProviders[provider][label] = {
        apiKey: String(labelConfig?.apiKey || '').trim(),
        model: String(labelConfig?.model || '').trim(),
      }
    }
  }

  const activeProvider = String(candidate.activeProvider || DEFAULT_PROVIDER)
  if (!SUPPORTED_PROVIDERS.includes(activeProvider)) {
    return { ok: false, error: `Unsupported activeProvider "${activeProvider}".` }
  }

  return {
    ok: true,
    value: {
      activeProvider,
      providers: normalizedProviders,
    },
  }
}

export async function getAdminAiProviderSettings() {
  await ensureAiProviderTable()

  const { rows } = await pool.query(
    `SELECT provider, key_label, model, api_key, is_active, updated_at
     FROM admin_ai_provider_keys
     WHERE provider = ANY($1::text[])
     ORDER BY provider ASC, key_label ASC`,
    [SUPPORTED_PROVIDERS],
  )

  const rowsByProvider = rows.reduce((acc, row) => {
    const provider = String(row.provider)
    if (!acc[provider]) acc[provider] = []
    acc[provider].push(row)
    return acc
  }, {})

  const providers = SUPPORTED_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = buildProviderSettings(provider, rowsByProvider[provider] || [])
    return acc
  }, {})

  return {
    activeProvider: DEFAULT_PROVIDER,
    providers,
    provider: DEFAULT_PROVIDER,
    defaultModel: getDefaultModel(DEFAULT_PROVIDER),
    allowedModels: AI_MODEL_CONFIG.allowedModels,
    primary: providers[DEFAULT_PROVIDER].primary,
    fallback: providers[DEFAULT_PROVIDER].fallback,
  }
}

export async function upsertAdminAiProviderKeys({ payload, adminId, primaryApiKey, fallbackApiKey, primaryModel, fallbackModel }) {
  await ensureAiProviderTable()

  const sourcePayload = payload
    ? normalizePayload(payload)
    : { ok: true, value: normalizeLegacyPayload({ primaryApiKey, fallbackApiKey, primaryModel, fallbackModel }) }

  if (!sourcePayload.ok) {
    const error = new Error(sourcePayload.error)
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  const normalizedPayload = sourcePayload.value

  const { rows } = await pool.query(
    `SELECT provider, key_label, api_key, model
     FROM admin_ai_provider_keys
     WHERE provider = ANY($1::text[])`,
    [SUPPORTED_PROVIDERS],
  )

  const existingByKey = new Map(
    rows.map((row) => [`${row.provider}:${row.key_label}`, row]),
  )

  const changeFlags = {
    primaryModelUpdated: false,
    fallbackModelUpdated: false,
    primaryKeyUpdated: false,
    fallbackKeyUpdated: false,
    updatesByProvider: {},
  }

  for (const provider of Object.keys(normalizedPayload.providers || {})) {
    const providerChanges = {}

    for (const label of KEY_LABELS) {
      const entry = normalizedPayload.providers?.[provider]?.[label] || { apiKey: '', model: '' }
      const existing = existingByKey.get(`${provider}:${label}`)
      const existingModel = existing?.model || getDefaultModel(provider)
      const modelProvided = entry.model.length > 0
      const hasApiKeyUpdate = entry.apiKey.length > 0
      const hasModelUpdateOnly = Boolean(!hasApiKeyUpdate && existing && modelProvided && entry.model !== existingModel)
      const targetModel = modelProvided ? entry.model : existingModel

      if (!hasApiKeyUpdate && !hasModelUpdateOnly) {
        continue
      }

      if (hasApiKeyUpdate) {
        await pool.query(
          `INSERT INTO admin_ai_provider_keys (provider, key_label, api_key, model, is_active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, true, $5, $5)
           ON CONFLICT (provider, key_label)
           DO UPDATE SET
             api_key = EXCLUDED.api_key,
             model = EXCLUDED.model,
             is_active = true,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [provider, label, entry.apiKey, targetModel, adminId || null],
        )
      } else {
        await pool.query(
          `UPDATE admin_ai_provider_keys
           SET model = $3,
               is_active = true,
               updated_by = $4,
               updated_at = NOW()
           WHERE provider = $1
             AND key_label = $2`,
          [provider, label, targetModel, adminId || null],
        )
      }

      providerChanges[`${label}KeyUpdated`] = hasApiKeyUpdate
      providerChanges[`${label}ModelUpdated`] = targetModel !== existingModel

      if (provider === DEFAULT_PROVIDER && label === 'primary') {
        changeFlags.primaryKeyUpdated = hasApiKeyUpdate
        changeFlags.primaryModelUpdated = targetModel !== existingModel
      }
      if (provider === DEFAULT_PROVIDER && label === 'fallback') {
        changeFlags.fallbackKeyUpdated = hasApiKeyUpdate
        changeFlags.fallbackModelUpdated = targetModel !== existingModel
      }
    }

    if (Object.keys(providerChanges).length > 0) {
      changeFlags.updatesByProvider[provider] = providerChanges
    }
  }

  return changeFlags
}

export async function validateAiProviderModelConfiguration() {
  await ensureAiProviderTable()

  const { rows } = await pool.query(
    `SELECT key_label, model
     FROM admin_ai_provider_keys
     WHERE provider = $1
       AND is_active = true`,
    [DEFAULT_PROVIDER],
  )

  const warnings = getAnthropicModelWarnings([
    { source: 'env.ANTHROPIC_RESUME_MODEL', keyLabel: null, model: getDefaultModel(DEFAULT_PROVIDER) },
    ...rows.map((row) => ({
      source: 'admin-console',
      keyLabel: row.key_label,
      model: row.model || getDefaultModel(DEFAULT_PROVIDER),
    })),
  ])

  return {
    allowedModels: AI_MODEL_CONFIG.allowedModels,
    warnings,
  }
}

export async function getActiveAiProviderCredentials() {
  await ensureAiProviderTable()

  const { rows } = await pool.query(
    `SELECT key_label, api_key, model, is_active
     FROM admin_ai_provider_keys
     WHERE provider = $1
     ORDER BY CASE key_label WHEN 'primary' THEN 1 ELSE 2 END`,
    [DEFAULT_PROVIDER],
  )

  const primary = rows.find((row) => row.key_label === 'primary' && row.is_active && row.api_key)
  const fallback = rows.find((row) => row.key_label === 'fallback' && row.is_active && row.api_key)

  return {
    provider: DEFAULT_PROVIDER,
    primary: {
      keyLabel: 'primary',
      apiKey: primary?.api_key || process.env.ANTHROPIC_API_KEY || '',
      model: primary?.model || getDefaultModel(DEFAULT_PROVIDER),
      source: primary?.api_key ? 'admin-console' : 'env',
    },
    fallback: {
      keyLabel: 'fallback',
      apiKey: fallback?.api_key || process.env.ANTHROPIC_FALLBACK_API_KEY || '',
      model: fallback?.model || getDefaultModel(DEFAULT_PROVIDER),
      source: fallback?.api_key ? 'admin-console' : 'env',
    },
  }
}
