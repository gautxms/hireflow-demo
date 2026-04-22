import { pool } from '../db/client.js'
import { AI_MODEL_CONFIG, getAnthropicModelWarnings } from '../config/aiModels.js'

const DEFAULT_PROVIDER = 'anthropic'
const SUPPORTED_PROVIDERS = ['anthropic', 'openai']
const KEY_LABELS = ['primary', 'fallback']

const PROVIDER_MODEL_CONFIG = {
  anthropic: {
    defaultModel: AI_MODEL_CONFIG.defaultModel,
    allowedModels: AI_MODEL_CONFIG.allowedModels,
  },
  openai: {
    defaultModel: process.env.OPENAI_RESUME_MODEL || 'gpt-4o-mini',
    allowedModels: String(process.env.OPENAI_ALLOWED_MODELS || process.env.OPENAI_RESUME_MODEL || 'gpt-4o-mini')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  },
}

let tablesEnsured = false

async function ensureAiProviderTables() {
  if (tablesEnsured) return

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_settings (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
      active_provider TEXT NOT NULL DEFAULT 'anthropic',
      settings_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(
    `INSERT INTO admin_ai_settings (id, active_provider)
     VALUES (true, $1)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_PROVIDER],
  )

  tablesEnsured = true
}

function maskApiKey(apiKey) {
  const value = String(apiKey || '').trim()
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function normalizeProviderModel(provider, model) {
  const normalizedModel = String(model || '').trim()
  if (normalizedModel) return normalizedModel
  return PROVIDER_MODEL_CONFIG[provider]?.defaultModel || AI_MODEL_CONFIG.defaultModel
}

function buildProviderSettings(provider, rows) {
  const byLabel = new Map(rows.map((row) => [row.key_label, row]))
  const defaultModel = PROVIDER_MODEL_CONFIG[provider]?.defaultModel || AI_MODEL_CONFIG.defaultModel
  const allowedModels = PROVIDER_MODEL_CONFIG[provider]?.allowedModels || []

  return {
    provider,
    defaultModel,
    allowedModels,
    primary: {
      configured: Boolean(byLabel.get('primary')?.api_key),
      maskedApiKey: maskApiKey(byLabel.get('primary')?.api_key),
      model: byLabel.get('primary')?.model || defaultModel,
      isActive: byLabel.get('primary') ? Boolean(byLabel.get('primary').is_active) : true,
      updatedAt: byLabel.get('primary')?.updated_at || null,
    },
    fallback: {
      configured: Boolean(byLabel.get('fallback')?.api_key),
      maskedApiKey: maskApiKey(byLabel.get('fallback')?.api_key),
      model: byLabel.get('fallback')?.model || defaultModel,
      isActive: byLabel.get('fallback') ? Boolean(byLabel.get('fallback').is_active) : true,
      updatedAt: byLabel.get('fallback')?.updated_at || null,
    },
  }
}

function normalizeLegacyPayload(payload = {}) {
  if (payload.providers && typeof payload.providers === 'object') {
    return {
      activeProvider: payload.activeProvider,
      providers: payload.providers,
      metadata: payload.metadata,
    }
  }

  return {
    activeProvider: DEFAULT_PROVIDER,
    providers: {
      anthropic: {
        primary: {
          apiKey: payload.primaryApiKey,
          model: payload.primaryModel,
        },
        fallback: {
          apiKey: payload.fallbackApiKey,
          model: payload.fallbackModel,
        },
      },
    },
    metadata: payload.metadata,
  }
}

function createEmptyChangeFlags() {
  const byProvider = Object.fromEntries(
    SUPPORTED_PROVIDERS.map((provider) => [provider, {
      primaryKeyUpdated: false,
      fallbackKeyUpdated: false,
      primaryModelUpdated: false,
      fallbackModelUpdated: false,
    }]),
  )

  return {
    activeProviderUpdated: false,
    providers: byProvider,
  }
}

export async function getAdminAiProviderSettings() {
  await ensureAiProviderTables()

  const [keysResult, settingsResult] = await Promise.all([
    pool.query(
      `SELECT provider, key_label, model, api_key, is_active, updated_at
       FROM admin_ai_provider_keys
       ORDER BY provider ASC, key_label ASC`,
    ),
    pool.query('SELECT active_provider, settings_metadata FROM admin_ai_settings WHERE id = true LIMIT 1'),
  ])

  const rowsByProvider = new Map()
  for (const provider of SUPPORTED_PROVIDERS) {
    rowsByProvider.set(provider, [])
  }

  for (const row of keysResult.rows) {
    const provider = String(row.provider || '').trim()
    if (!rowsByProvider.has(provider)) continue
    rowsByProvider.get(provider).push(row)
  }

  const providers = Object.fromEntries(
    SUPPORTED_PROVIDERS.map((provider) => [provider, buildProviderSettings(provider, rowsByProvider.get(provider) || [])]),
  )

  const activeProvider = settingsResult.rows[0]?.active_provider
  const normalizedActiveProvider = SUPPORTED_PROVIDERS.includes(activeProvider) ? activeProvider : DEFAULT_PROVIDER

  return {
    activeProvider: normalizedActiveProvider,
    metadata: settingsResult.rows[0]?.settings_metadata || {},
    providers,
  }
}

export async function upsertAdminAiProviderKeys({ payload, adminId }) {
  await ensureAiProviderTables()

  const normalizedPayload = normalizeLegacyPayload(payload)
  const changeFlags = createEmptyChangeFlags()

  const activeProvider = String(normalizedPayload.activeProvider || DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER
  const metadata = normalizedPayload.metadata && typeof normalizedPayload.metadata === 'object' ? normalizedPayload.metadata : null

  const existingResult = await pool.query(
    `SELECT provider, key_label, api_key, model
     FROM admin_ai_provider_keys`,
  )

  const existingByProviderAndLabel = new Map(
    existingResult.rows.map((row) => [`${row.provider}:${row.key_label}`, row]),
  )

  for (const provider of SUPPORTED_PROVIDERS) {
    const providerPayload = normalizedPayload.providers?.[provider]
    if (!providerPayload || typeof providerPayload !== 'object') continue

    for (const keyLabel of KEY_LABELS) {
      const entry = providerPayload?.[keyLabel]
      if (!entry || typeof entry !== 'object') continue

      const incomingApiKey = String(entry.apiKey || '').trim()
      const modelProvided = typeof entry.model === 'string' && String(entry.model).trim().length > 0
      const incomingModel = modelProvided ? String(entry.model).trim() : ''
      const existing = existingByProviderAndLabel.get(`${provider}:${keyLabel}`)
      const existingModel = normalizeProviderModel(provider, existing?.model)
      const targetModel = modelProvided ? incomingModel : existingModel

      const hasApiKeyUpdate = Boolean(incomingApiKey)
      const hasModelUpdateOnly = Boolean(!incomingApiKey && existing && modelProvided && incomingModel !== existingModel)

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
          [provider, keyLabel, incomingApiKey, targetModel, adminId || null],
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
          [provider, keyLabel, targetModel, adminId || null],
        )
      }

      existingByProviderAndLabel.set(`${provider}:${keyLabel}`, {
        provider,
        key_label: keyLabel,
        api_key: incomingApiKey || existing?.api_key || '',
        model: targetModel,
      })

      const keyPrefix = keyLabel === 'primary' ? 'primary' : 'fallback'
      changeFlags.providers[provider][`${keyPrefix}KeyUpdated`] = hasApiKeyUpdate
      changeFlags.providers[provider][`${keyPrefix}ModelUpdated`] = targetModel !== existingModel
    }
  }

  const settingsResult = await pool.query('SELECT active_provider FROM admin_ai_settings WHERE id = true LIMIT 1')
  const existingActiveProvider = settingsResult.rows[0]?.active_provider || DEFAULT_PROVIDER
  const nextActiveProvider = SUPPORTED_PROVIDERS.includes(activeProvider) ? activeProvider : DEFAULT_PROVIDER

  if (existingActiveProvider !== nextActiveProvider || metadata) {
    await pool.query(
      `INSERT INTO admin_ai_settings (id, active_provider, settings_metadata, updated_by)
       VALUES (true, $1, COALESCE($2::jsonb, '{}'::jsonb), $3)
       ON CONFLICT (id)
       DO UPDATE SET
         active_provider = EXCLUDED.active_provider,
         settings_metadata = COALESCE($2::jsonb, admin_ai_settings.settings_metadata),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [nextActiveProvider, metadata ? JSON.stringify(metadata) : null, adminId || null],
    )
    changeFlags.activeProviderUpdated = existingActiveProvider !== nextActiveProvider
  }

  return changeFlags
}


export async function validateAiProviderModelConfiguration() {
  await ensureAiProviderTables()

  const { rows } = await pool.query(
    `SELECT provider, key_label, model
     FROM admin_ai_provider_keys
     WHERE provider = ANY($1::text[])
       AND is_active = true`,
    [SUPPORTED_PROVIDERS],
  )

  const warnings = []

  const anthropicWarnings = getAnthropicModelWarnings([
    { source: 'env.ANTHROPIC_RESUME_MODEL', keyLabel: null, model: AI_MODEL_CONFIG.defaultModel },
    ...rows
      .filter((row) => row.provider === 'anthropic')
      .map((row) => ({
        source: 'admin-console',
        keyLabel: row.key_label,
        model: row.model || AI_MODEL_CONFIG.defaultModel,
      })),
  ])

  warnings.push(...anthropicWarnings.map((entry) => ({
    provider: 'anthropic',
    source: entry.source,
    keyLabel: entry.keyLabel,
    model: entry.model,
    reason: 'invalid_or_deprecated_model',
  })))

  for (const provider of SUPPORTED_PROVIDERS.filter((item) => item !== 'anthropic')) {
    const allowedModels = PROVIDER_MODEL_CONFIG[provider]?.allowedModels || []
    if (!allowedModels.length) continue

    const rowsForProvider = rows.filter((row) => row.provider === provider)
    for (const row of rowsForProvider) {
      const model = String(row.model || '').trim()
      if (!model) continue
      if (allowedModels.includes(model)) continue

      warnings.push({
        provider,
        source: 'admin-console',
        keyLabel: row.key_label,
        model,
        reason: 'invalid_or_deprecated_model',
      })
    }
  }

  return {
    allowedModelsByProvider: Object.fromEntries(
      SUPPORTED_PROVIDERS.map((provider) => [provider, PROVIDER_MODEL_CONFIG[provider]?.allowedModels || []]),
    ),
    warnings,
  }
}

export async function getActiveAiProviderCredentials() {
  await ensureAiProviderTables()

  const [keysResult, settingsResult] = await Promise.all([
    pool.query(
      `SELECT provider, key_label, api_key, model, is_active
       FROM admin_ai_provider_keys
       WHERE provider = ANY($1::text[])
       ORDER BY provider ASC, CASE key_label WHEN 'primary' THEN 1 ELSE 2 END`,
      [SUPPORTED_PROVIDERS],
    ),
    pool.query('SELECT active_provider FROM admin_ai_settings WHERE id = true LIMIT 1'),
  ])

  const rowsByProvider = new Map(SUPPORTED_PROVIDERS.map((provider) => [provider, []]))
  for (const row of keysResult.rows) {
    const provider = String(row.provider || '').trim()
    if (!rowsByProvider.has(provider)) continue
    rowsByProvider.get(provider).push(row)
  }

  const providers = Object.fromEntries(SUPPORTED_PROVIDERS.map((provider) => {
    const rows = rowsByProvider.get(provider) || []
    const primary = rows.find((row) => row.key_label === 'primary' && row.is_active && row.api_key)
    const fallback = rows.find((row) => row.key_label === 'fallback' && row.is_active && row.api_key)
    const envPrimaryKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
    const envFallbackKey = provider === 'anthropic' ? process.env.ANTHROPIC_FALLBACK_API_KEY : process.env.OPENAI_FALLBACK_API_KEY
    const defaultModel = PROVIDER_MODEL_CONFIG[provider]?.defaultModel || AI_MODEL_CONFIG.defaultModel

    return [provider, {
      provider,
      primary: {
        keyLabel: 'primary',
        apiKey: primary?.api_key || envPrimaryKey || '',
        model: primary?.model || defaultModel,
        source: primary?.api_key ? 'admin-console' : 'env',
      },
      fallback: {
        keyLabel: 'fallback',
        apiKey: fallback?.api_key || envFallbackKey || '',
        model: fallback?.model || defaultModel,
        source: fallback?.api_key ? 'admin-console' : 'env',
      },
    }]
  }))

  const activeProvider = settingsResult.rows[0]?.active_provider

  return {
    activeProvider: SUPPORTED_PROVIDERS.includes(activeProvider) ? activeProvider : DEFAULT_PROVIDER,
    providers,
  }
}

export { SUPPORTED_PROVIDERS, KEY_LABELS }
