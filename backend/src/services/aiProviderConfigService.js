import { pool } from '../db/client.js'
import { PROVIDER_MODEL_BOOTSTRAP, isValidModelFormat } from '../config/aiModels.js'
import { getUsersIdReferenceType } from './adminAiSchemaCompatibility.js'

const DEFAULT_PROVIDER = 'anthropic'
const SUPPORTED_PROVIDERS = ['anthropic', 'openai']
const KEY_LABELS = ['primary', 'fallback']
const DEFAULT_GOVERNANCE = {
  aiEnabled: true,
  workflowToggles: {
    resumeAnalysisEnabled: true,
  },
}

const PROVIDER_MODEL_CONFIG = {
  anthropic: {
    defaultModel: PROVIDER_MODEL_BOOTSTRAP.anthropic.defaultModel,
    seedModels: PROVIDER_MODEL_BOOTSTRAP.anthropic.seedModels,
  },
  openai: {
    defaultModel: PROVIDER_MODEL_BOOTSTRAP.openai.defaultModel,
    seedModels: PROVIDER_MODEL_BOOTSTRAP.openai.seedModels,
  },
}
const PROVIDER_MODEL_SYNC_ENDPOINTS = {
  anthropic: process.env.ANTHROPIC_MODEL_METADATA_ENDPOINT || 'https://api.anthropic.com/v1/models',
  openai: process.env.OPENAI_MODEL_METADATA_ENDPOINT || 'https://api.openai.com/v1/models',
}
const PROVIDER_MODEL_SYNC_TIMEOUT_MS = 15000

let tablesEnsured = false

async function ensureAiProviderTables() {
  if (tablesEnsured) return

  let usersIdType
  try {
    usersIdType = await getUsersIdReferenceType(pool)
  } catch (error) {
    throw new Error(
      `[AI Provider Config] Failed to detect users.id type before ensuring AI provider tables. Verify migrations and schema compatibility are up to date, then retry startup. Root cause: ${error.message}`,
    )
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_provider_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      key_label TEXT NOT NULL CHECK (key_label IN ('primary', 'fallback')),
      api_key TEXT NOT NULL,
      model TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by ${usersIdType},
      updated_by ${usersIdType},
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
      updated_by ${usersIdType},
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_model_registry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      display_name TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (provider, model_id)
    );
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_ai_model_registry_provider
      ON admin_ai_model_registry (provider, status, model_id);
  `)

  await pool.query(
    `INSERT INTO admin_ai_settings (id, active_provider)
     VALUES (true, $1)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_PROVIDER],
  )

  for (const provider of SUPPORTED_PROVIDERS) {
    const seedModels = PROVIDER_MODEL_CONFIG[provider]?.seedModels || []
    for (const modelId of seedModels) {
      if (!isValidModelFormat(modelId)) continue
      await pool.query(
        `INSERT INTO admin_ai_model_registry (provider, model_id, status, display_name, metadata, source)
         VALUES ($1, $2, 'active', $2, '{}'::jsonb, 'env_seed')
         ON CONFLICT (provider, model_id) DO NOTHING`,
        [provider, modelId],
      )
    }
  }

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
  return PROVIDER_MODEL_CONFIG[provider]?.defaultModel || PROVIDER_MODEL_BOOTSTRAP.anthropic.defaultModel
}

function normalizeGovernanceConfig(governance = {}) {
  const workflowToggles = governance?.workflowToggles && typeof governance.workflowToggles === 'object'
    ? governance.workflowToggles
    : {}

  return {
    aiEnabled: typeof governance?.aiEnabled === 'boolean'
      ? governance.aiEnabled
      : DEFAULT_GOVERNANCE.aiEnabled,
    workflowToggles: {
      resumeAnalysisEnabled: typeof workflowToggles.resumeAnalysisEnabled === 'boolean'
        ? workflowToggles.resumeAnalysisEnabled
        : DEFAULT_GOVERNANCE.workflowToggles.resumeAnalysisEnabled,
    },
  }
}

function extractGovernanceFromMetadata(metadata = {}) {
  const nextMetadata = metadata && typeof metadata === 'object' ? metadata : {}
  return normalizeGovernanceConfig(nextMetadata.governance || {})
}

function normalizeLegacyPayload(payload = {}) {
  if (payload.providers && typeof payload.providers === 'object') {
    return {
      activeProvider: payload.activeProvider,
      providers: payload.providers,
      governance: payload.governance,
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
    governance: payload.governance,
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
    governanceUpdated: false,
    aiEnabledUpdated: false,
    workflowTogglesUpdated: false,
    providers: byProvider,
  }
}

function buildProviderSettings(provider, rows) {
  const byLabel = new Map(rows.map((row) => [row.key_label, row]))
  const defaultModel = PROVIDER_MODEL_CONFIG[provider]?.defaultModel || PROVIDER_MODEL_BOOTSTRAP.anthropic.defaultModel

  return {
    provider,
    defaultModel,
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

async function getRegistryRowsByProvider() {
  const { rows } = await pool.query(
    `SELECT provider, model_id, status, display_name, metadata, source
     FROM admin_ai_model_registry
     WHERE provider = ANY($1::text[])
     ORDER BY provider ASC, model_id ASC`,
    [SUPPORTED_PROVIDERS],
  )

  const grouped = new Map(SUPPORTED_PROVIDERS.map((provider) => [provider, []]))
  for (const row of rows) {
    const provider = String(row.provider || '').trim()
    if (!grouped.has(provider)) continue
    grouped.get(provider).push(row)
  }
  return grouped
}

function normalizeDiscoveredModelIds(payload = {}) {
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows
    .map((row) => String(row?.id || '').trim())
    .filter((modelId, index, list) => Boolean(modelId) && list.indexOf(modelId) === index)
}

async function fetchProviderModelIds({ provider, apiKey }) {
  const endpoint = PROVIDER_MODEL_SYNC_ENDPOINTS[provider]
  if (!endpoint) {
    throw new Error(`No model sync endpoint configured for provider "${provider}".`)
  }

  const headers = provider === 'anthropic'
    ? {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    : {
        Authorization: `Bearer ${apiKey}`,
      }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_MODEL_SYNC_TIMEOUT_MS)

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const body = await response.json()
        errorMessage = body?.error?.message || body?.message || errorMessage
      } catch {
        errorMessage = `HTTP ${response.status}`
      }
      throw new Error(errorMessage)
    }

    const payload = await response.json()
    const modelIds = normalizeDiscoveredModelIds(payload)
    if (!modelIds.length) {
      throw new Error('Provider returned no models.')
    }

    return {
      endpoint,
      modelIds,
      rawCount: Array.isArray(payload?.data) ? payload.data.length : 0,
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Model sync timed out while contacting provider API.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function syncProviderModelRegistry({ provider, adminId = null }) {
  await ensureAiProviderTables()

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`)
  }

  const credentials = await getActiveAiProviderCredentials()
  const providerCredentials = credentials?.providers?.[provider]
  const apiKey = String(providerCredentials?.primary?.apiKey || providerCredentials?.fallback?.apiKey || '').trim()
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Add a key manually and retry sync.`)
  }

  const fetched = await fetchProviderModelIds({ provider, apiKey })
  const nowIso = new Date().toISOString()
  let upserted = 0

  for (const modelId of fetched.modelIds) {
    const result = await pool.query(
      `INSERT INTO admin_ai_model_registry (provider, model_id, status, display_name, metadata, source, updated_at)
       VALUES ($1, $2, 'active', $2, $3::jsonb, 'provider_api', NOW())
       ON CONFLICT (provider, model_id)
       DO UPDATE SET
         status = 'active',
         display_name = EXCLUDED.display_name,
         metadata = EXCLUDED.metadata,
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING id`,
      [
        provider,
        modelId,
        JSON.stringify({
          sync: {
            syncedAt: nowIso,
            source: fetched.endpoint,
            actor: adminId || null,
          },
        }),
      ],
    )
    upserted += result.rowCount || 0
  }

  return {
    provider,
    endpoint: fetched.endpoint,
    discovered: fetched.modelIds.length,
    upserted,
    syncedAt: nowIso,
    fallbackManualEntry: true,
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

  const rowsByProvider = new Map(SUPPORTED_PROVIDERS.map((provider) => [provider, []]))
  for (const row of keysResult.rows) {
    const provider = String(row.provider || '').trim()
    if (!rowsByProvider.has(provider)) continue
    rowsByProvider.get(provider).push(row)
  }

  const registryRowsByProvider = await getRegistryRowsByProvider()
  const providers = Object.fromEntries(
    SUPPORTED_PROVIDERS.map((provider) => {
      const providerSettings = buildProviderSettings(provider, rowsByProvider.get(provider) || [])
      const registryRows = registryRowsByProvider.get(provider) || []
      return [provider, {
        ...providerSettings,
        modelRegistry: registryRows.map((row) => ({
          modelId: row.model_id,
          status: row.status,
          displayName: row.display_name || row.model_id,
          metadata: row.metadata || {},
          source: row.source || 'admin',
        })),
      }]
    }),
  )

  const activeProvider = settingsResult.rows[0]?.active_provider
  const normalizedActiveProvider = SUPPORTED_PROVIDERS.includes(activeProvider) ? activeProvider : DEFAULT_PROVIDER

  return {
    activeProvider: normalizedActiveProvider,
    metadata: settingsResult.rows[0]?.settings_metadata || {},
    governance: extractGovernanceFromMetadata(settingsResult.rows[0]?.settings_metadata || {}),
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
      if (!hasApiKeyUpdate && !hasModelUpdateOnly) continue

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

      const keyPrefix = keyLabel === 'primary' ? 'primary' : 'fallback'
      changeFlags.providers[provider][`${keyPrefix}KeyUpdated`] = hasApiKeyUpdate
      changeFlags.providers[provider][`${keyPrefix}ModelUpdated`] = targetModel !== existingModel
    }
  }

  const settingsResult = await pool.query('SELECT active_provider FROM admin_ai_settings WHERE id = true LIMIT 1')
  const existingActiveProvider = settingsResult.rows[0]?.active_provider || DEFAULT_PROVIDER
  const nextActiveProvider = SUPPORTED_PROVIDERS.includes(activeProvider) ? activeProvider : DEFAULT_PROVIDER

  const currentSettingsResult = await pool.query(
    'SELECT active_provider, settings_metadata FROM admin_ai_settings WHERE id = true LIMIT 1',
  )
  const existingMetadata = currentSettingsResult.rows[0]?.settings_metadata || {}
  const currentGovernance = extractGovernanceFromMetadata(existingMetadata)
  const incomingGovernance = normalizeGovernanceConfig({
    ...(currentGovernance || {}),
    ...(normalizedPayload?.governance && typeof normalizedPayload.governance === 'object' ? normalizedPayload.governance : {}),
  })

  const nextMetadata = metadata
    ? { ...metadata, governance: incomingGovernance }
    : { ...(existingMetadata || {}), governance: incomingGovernance }

  if (existingActiveProvider !== nextActiveProvider || metadata || JSON.stringify(nextMetadata) !== JSON.stringify(existingMetadata)) {
    await pool.query(
      `INSERT INTO admin_ai_settings (id, active_provider, settings_metadata, updated_by)
       VALUES (true, $1, COALESCE($2::jsonb, '{}'::jsonb), $3)
       ON CONFLICT (id)
       DO UPDATE SET
         active_provider = EXCLUDED.active_provider,
         settings_metadata = COALESCE($2::jsonb, admin_ai_settings.settings_metadata),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [nextActiveProvider, JSON.stringify(nextMetadata), adminId || null],
    )
    changeFlags.activeProviderUpdated = existingActiveProvider !== nextActiveProvider
    changeFlags.aiEnabledUpdated = currentGovernance.aiEnabled !== incomingGovernance.aiEnabled
    changeFlags.workflowTogglesUpdated = currentGovernance.workflowToggles.resumeAnalysisEnabled !== incomingGovernance.workflowToggles.resumeAnalysisEnabled
    changeFlags.governanceUpdated = changeFlags.aiEnabledUpdated || changeFlags.workflowTogglesUpdated
  }

  return changeFlags
}

export async function validateAiProviderModelConfiguration() {
  await ensureAiProviderTables()

  const [configResult, registryRowsByProvider] = await Promise.all([
    pool.query(
      `SELECT provider, key_label, model
       FROM admin_ai_provider_keys
       WHERE provider = ANY($1::text[])
         AND is_active = true`,
      [SUPPORTED_PROVIDERS],
    ),
    getRegistryRowsByProvider(),
  ])

  const warnings = []
  for (const provider of SUPPORTED_PROVIDERS) {
    const providerRows = configResult.rows.filter((row) => row.provider === provider)
    const registryRows = registryRowsByProvider.get(provider) || []
    const registryByModel = new Map(registryRows.map((row) => [String(row.model_id || '').trim(), row]))
    const hasRegistryEntries = registryByModel.size > 0

    for (const row of providerRows) {
      const model = String(row.model || '').trim()
      if (!model) continue

      if (!isValidModelFormat(model)) {
        warnings.push({
          provider,
          source: 'admin-console',
          keyLabel: row.key_label,
          model,
          reason: 'invalid_format',
        })
        continue
      }

      if (!hasRegistryEntries) {
        warnings.push({
          provider,
          source: 'admin-console',
          keyLabel: row.key_label,
          model,
          reason: 'risky_untested_model',
          detail: 'provider_registry_empty',
        })
        continue
      }

      const entry = registryByModel.get(model)
      if (!entry) {
        warnings.push({
          provider,
          source: 'admin-console',
          keyLabel: row.key_label,
          model,
          reason: 'risky_untested_model',
          detail: 'model_not_registered',
        })
        continue
      }

      const status = String(entry.status || '').trim().toLowerCase() || 'active'
      if (['experimental', 'untested'].includes(status)) {
        warnings.push({
          provider,
          source: 'admin-console',
          keyLabel: row.key_label,
          model,
          reason: 'risky_untested_model',
          detail: `registry_status:${status}`,
        })
      } else if (['deprecated', 'retired', 'blocked', 'inactive'].includes(status)) {
        warnings.push({
          provider,
          source: 'admin-console',
          keyLabel: row.key_label,
          model,
          reason: 'invalid_or_deprecated_model',
          detail: `registry_status:${status}`,
        })
      }
    }
  }

  return {
    allowedModelsByProvider: Object.fromEntries(
      SUPPORTED_PROVIDERS.map((provider) => [
        provider,
        (registryRowsByProvider.get(provider) || [])
          .filter((row) => ['active', 'experimental', 'untested'].includes(String(row.status || '').trim().toLowerCase() || 'active'))
          .map((row) => row.model_id),
      ]),
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
    pool.query('SELECT active_provider, settings_metadata FROM admin_ai_settings WHERE id = true LIMIT 1'),
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
    const defaultModel = PROVIDER_MODEL_CONFIG[provider]?.defaultModel || PROVIDER_MODEL_BOOTSTRAP.anthropic.defaultModel

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
    governance: extractGovernanceFromMetadata(settingsResult.rows[0]?.settings_metadata || {}),
    providers,
  }
}

export { SUPPORTED_PROVIDERS, KEY_LABELS }
