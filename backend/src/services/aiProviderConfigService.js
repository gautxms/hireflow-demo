import { pool } from '../db/client.js'

const DEFAULT_PROVIDER = 'anthropic'
const DEFAULT_MODEL = process.env.ANTHROPIC_RESUME_MODEL || 'claude-3-5-sonnet-20241022'

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

function maskApiKey(apiKey) {
  const value = String(apiKey || '').trim()
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export async function getAdminAiProviderSettings() {
  await ensureAiProviderTable()

  const { rows } = await pool.query(
    `SELECT provider, key_label, model, api_key, is_active, updated_at
     FROM admin_ai_provider_keys
     WHERE provider = $1
     ORDER BY key_label ASC`,
    [DEFAULT_PROVIDER],
  )

  const byLabel = new Map(rows.map((row) => [row.key_label, row]))

  const primary = byLabel.get('primary')
  const fallback = byLabel.get('fallback')

  return {
    provider: DEFAULT_PROVIDER,
    primary: {
      configured: Boolean(primary?.api_key),
      maskedApiKey: maskApiKey(primary?.api_key),
      model: primary?.model || DEFAULT_MODEL,
      isActive: primary ? Boolean(primary.is_active) : true,
      updatedAt: primary?.updated_at || null,
    },
    fallback: {
      configured: Boolean(fallback?.api_key),
      maskedApiKey: maskApiKey(fallback?.api_key),
      model: fallback?.model || DEFAULT_MODEL,
      isActive: fallback ? Boolean(fallback.is_active) : true,
      updatedAt: fallback?.updated_at || null,
    },
  }
}

export async function upsertAdminAiProviderKeys({ primaryApiKey, fallbackApiKey, primaryModel, fallbackModel, adminId }) {
  await ensureAiProviderTable()

  const normalizedUpdates = [
    { label: 'primary', apiKey: String(primaryApiKey || '').trim(), model: String(primaryModel || '').trim() || DEFAULT_MODEL },
    { label: 'fallback', apiKey: String(fallbackApiKey || '').trim(), model: String(fallbackModel || '').trim() || DEFAULT_MODEL },
  ]

  const { rows } = await pool.query(
    `SELECT key_label, api_key, model
     FROM admin_ai_provider_keys
     WHERE provider = $1`,
    [DEFAULT_PROVIDER],
  )
  const existingByLabel = new Map(rows.map((row) => [row.key_label, row]))

  const changeFlags = {
    primaryModelUpdated: false,
    fallbackModelUpdated: false,
    primaryKeyUpdated: false,
    fallbackKeyUpdated: false,
  }

  for (const entry of normalizedUpdates) {
    const existing = existingByLabel.get(entry.label)
    const hasApiKeyUpdate = Boolean(entry.apiKey)
    const hasModelUpdateOnly = Boolean(!entry.apiKey && existing && entry.model && entry.model !== (existing.model || DEFAULT_MODEL))

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
        [DEFAULT_PROVIDER, entry.label, entry.apiKey, entry.model, adminId || null],
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
        [DEFAULT_PROVIDER, entry.label, entry.model, adminId || null],
      )
    }

    const existingModel = existing?.model || DEFAULT_MODEL
    if (entry.label === 'primary') {
      changeFlags.primaryKeyUpdated = hasApiKeyUpdate
      changeFlags.primaryModelUpdated = entry.model !== existingModel
    }
    if (entry.label === 'fallback') {
      changeFlags.fallbackKeyUpdated = hasApiKeyUpdate
      changeFlags.fallbackModelUpdated = entry.model !== existingModel
    }
  }

  return changeFlags
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
      model: primary?.model || DEFAULT_MODEL,
      source: primary?.api_key ? 'admin-console' : 'env',
    },
    fallback: {
      keyLabel: 'fallback',
      apiKey: fallback?.api_key || process.env.ANTHROPIC_FALLBACK_API_KEY || '',
      model: fallback?.model || DEFAULT_MODEL,
      source: fallback?.api_key ? 'admin-console' : 'env',
    },
  }
}
