import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import { syncProviderModelRegistry, upsertAdminAiProviderKeys, validateAiProviderModelConfiguration } from './aiProviderConfigService.js'

const originalQuery = pool.query.bind(pool)
const originalFetch = global.fetch

test.after(() => {
  pool.query = originalQuery
  global.fetch = originalFetch
})

test('validateAiProviderModelConfiguration surfaces descriptive users.id detection failures', async () => {
  pool.query = async (queryText) => {
    const sql = String(queryText)
    if (sql.includes('SELECT format_type(a.atttypid, a.atttypmod) AS data_type')) {
      throw new Error('db unavailable')
    }
    return { rows: [] }
  }

  await assert.rejects(
    () => validateAiProviderModelConfiguration(),
    /Failed to detect users\.id type before ensuring AI provider tables\. Verify migrations and schema compatibility are up to date, then retry startup\./,
  )
})

test('validateAiProviderModelConfiguration ensures tables using detected users.id type', async () => {
  const executedSql = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')
    executedSql.push(sql)

    if (sql.includes('SELECT format_type(a.atttypid, a.atttypmod) AS data_type')) {
      return { rows: [{ data_type: 'character varying' }] }
    }

    if (sql.startsWith('SELECT provider, key_label, model FROM admin_ai_provider_keys')) {
      return { rows: [] }
    }

    if (sql.startsWith('SELECT provider, model_id, status, display_name, metadata, source FROM admin_ai_model_registry')) {
      return { rows: [] }
    }

    if (sql.startsWith('CREATE TABLE IF NOT EXISTS') || sql.startsWith('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_settings')) {
      return { rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_model_registry')) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in aiProviderConfigService.test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const result = await validateAiProviderModelConfiguration()
  assert.deepEqual(result.warnings, [])
  assert.equal(typeof result.allowedModelsByProvider, 'object')

  const providerKeysCreate = executedSql.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS admin_ai_provider_keys'))
  const settingsCreate = executedSql.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS admin_ai_settings'))

  assert.match(providerKeysCreate || '', /created_by text/i)
  assert.match(providerKeysCreate || '', /updated_by text/i)
  assert.match(settingsCreate || '', /updated_by text/i)
})

test('syncProviderModelRegistry upserts provider discovered models', async () => {
  const executed = []
  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')
    executed.push({ sql, params })

    if (sql.startsWith('SELECT provider, key_label, api_key, model, is_active FROM admin_ai_provider_keys')) {
      return {
        rows: [
          {
            provider: 'openai',
            key_label: 'primary',
            api_key: 'sk-test-key',
            model: 'gpt-4o-mini',
            is_active: true,
          },
        ],
      }
    }

    if (sql.startsWith('SELECT active_provider, settings_metadata FROM admin_ai_settings')) {
      return { rows: [{ active_provider: 'openai', settings_metadata: {} }] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_model_registry')) {
      return { rowCount: 1, rows: [{ id: 'row-id' }] }
    }

    throw new Error(`Unexpected SQL in syncProviderModelRegistry test: ${sql} | params=${JSON.stringify(params)}`)
  }

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4o-mini' }],
    }),
  })

  const result = await syncProviderModelRegistry({ provider: 'openai', adminId: 'admin-1' })
  assert.equal(result.provider, 'openai')
  assert.equal(result.discovered, 2)
  assert.equal(result.upserted, 2)
  assert.equal(result.fallbackManualEntry, true)

  const upserts = executed.filter((entry) => entry.sql.startsWith('INSERT INTO admin_ai_model_registry'))
  assert.equal(upserts.length, 2)
})

test('validateAiProviderModelConfiguration returns tiered warnings with remediation steps', async () => {
  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')

    if (sql.includes('SELECT format_type(a.atttypid, a.atttypmod) AS data_type')) {
      return { rows: [{ data_type: 'character varying' }] }
    }

    if (sql.startsWith('SELECT provider, key_label, model FROM admin_ai_provider_keys')) {
      return {
        rows: [
          { provider: 'anthropic', key_label: 'primary', model: 'invalid model' },
          { provider: 'anthropic', key_label: 'fallback', model: 'claude-custom-2026' },
          { provider: 'openai', key_label: 'primary', model: 'gpt-4o-mini' },
        ],
      }
    }

    if (sql.startsWith('SELECT provider, model_id, status, display_name, metadata, source FROM admin_ai_model_registry')) {
      return {
        rows: [
          { provider: 'openai', model_id: 'gpt-4o-mini', status: 'active', display_name: 'GPT-4o mini', metadata: {}, source: 'provider-sync' },
        ],
      }
    }

    if (sql.startsWith('CREATE TABLE IF NOT EXISTS') || sql.startsWith('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_settings')) {
      return { rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_model_registry')) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in tiered validation test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const result = await validateAiProviderModelConfiguration()
  assert.equal(Array.isArray(result.warnings), true)

  const invalidFormat = result.warnings.find((warning) => warning.validationTier === 'invalid_format')
  assert.equal(invalidFormat?.provider, 'anthropic')
  assert.equal(Array.isArray(invalidFormat?.remediationSteps), true)
  assert.equal(invalidFormat.remediationSteps.length > 0, true)

  const validUnlisted = result.warnings.find((warning) => warning.validationTier === 'valid_unlisted')
  assert.equal(validUnlisted?.provider, 'anthropic')
  assert.equal(['model_not_registered', 'provider_registry_empty'].includes(validUnlisted?.detail), true)
})

test('upsertAdminAiProviderKeys preserves existing model when payload omits model field', async () => {
  const state = {
    rows: [
      { provider: 'anthropic', key_label: 'primary', api_key: 'old-primary', model: 'claude-sonnet-4-20250514' },
      { provider: 'openai', key_label: 'fallback', api_key: 'openai-fallback', model: 'gpt-4o-mini' },
    ],
    activeProvider: 'anthropic',
    metadata: {},
  }

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')

    if (sql.startsWith('SELECT provider, key_label, api_key, model FROM admin_ai_provider_keys')) {
      return { rows: state.rows.map((row) => ({ ...row })) }
    }

    if (sql.startsWith('INSERT INTO admin_ai_provider_keys')) {
      const [provider, keyLabel, apiKey, model] = params
      const existingIndex = state.rows.findIndex((row) => row.provider === provider && row.key_label === keyLabel)
      const nextRow = { provider, key_label: keyLabel, api_key: apiKey, model }
      if (existingIndex >= 0) state.rows[existingIndex] = nextRow
      else state.rows.push(nextRow)
      return { rowCount: 1, rows: [] }
    }

    if (sql.startsWith('SELECT active_provider FROM admin_ai_settings WHERE id = true LIMIT 1')) {
      return { rows: [{ active_provider: state.activeProvider }] }
    }

    if (sql.startsWith('SELECT active_provider, settings_metadata FROM admin_ai_settings WHERE id = true LIMIT 1')) {
      return { rows: [{ active_provider: state.activeProvider, settings_metadata: state.metadata }] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_settings')) {
      state.activeProvider = params[0]
      state.metadata = JSON.parse(params[1] || '{}')
      return { rowCount: 1, rows: [] }
    }

    throw new Error(`Unexpected SQL in upsertAdminAiProviderKeys test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const flags = await upsertAdminAiProviderKeys({
    payload: {
      activeProvider: 'anthropic',
      providers: {
        anthropic: {
          primary: {
            apiKey: 'new-primary',
          },
        },
      },
    },
    adminId: 'admin-1',
  })

  const anthropicPrimary = state.rows.find((row) => row.provider === 'anthropic' && row.key_label === 'primary')
  const openaiFallback = state.rows.find((row) => row.provider === 'openai' && row.key_label === 'fallback')

  assert.equal(anthropicPrimary?.model, 'claude-sonnet-4-20250514')
  assert.equal(openaiFallback?.model, 'gpt-4o-mini')
  assert.equal(flags.providers.anthropic.primaryKeyUpdated, true)
  assert.equal(flags.providers.anthropic.primaryModelUpdated, false)
  assert.equal(flags.providers.openai.fallbackKeyUpdated, false)
  assert.equal(flags.providers.openai.fallbackModelUpdated, false)
})

test('upsertAdminAiProviderKeys updates only explicitly provided model slots in partial payloads', async () => {
  const state = {
    rows: [
      { provider: 'anthropic', key_label: 'primary', api_key: 'anthropic-primary', model: 'claude-sonnet-4-20250514' },
      { provider: 'anthropic', key_label: 'fallback', api_key: 'anthropic-fallback', model: 'claude-3-5-haiku-latest' },
      { provider: 'openai', key_label: 'primary', api_key: 'openai-primary', model: 'gpt-4o-mini' },
      { provider: 'openai', key_label: 'fallback', api_key: 'openai-fallback', model: 'gpt-4.1-mini' },
    ],
    activeProvider: 'anthropic',
    metadata: {},
  }

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')

    if (sql.startsWith('SELECT provider, key_label, api_key, model FROM admin_ai_provider_keys')) {
      return { rows: state.rows.map((row) => ({ ...row })) }
    }

    if (sql.startsWith('INSERT INTO admin_ai_provider_keys')) {
      const [provider, keyLabel, apiKey, model] = params
      const existingIndex = state.rows.findIndex((row) => row.provider === provider && row.key_label === keyLabel)
      const nextRow = { provider, key_label: keyLabel, api_key: apiKey, model }
      if (existingIndex >= 0) state.rows[existingIndex] = nextRow
      else state.rows.push(nextRow)
      return { rowCount: 1, rows: [] }
    }

    if (sql.startsWith('UPDATE admin_ai_provider_keys SET model = $3')) {
      const [provider, keyLabel, model] = params
      const existingIndex = state.rows.findIndex((row) => row.provider === provider && row.key_label === keyLabel)
      if (existingIndex >= 0) state.rows[existingIndex] = { ...state.rows[existingIndex], model }
      return { rowCount: existingIndex >= 0 ? 1 : 0, rows: [] }
    }

    if (sql.startsWith('SELECT active_provider FROM admin_ai_settings WHERE id = true LIMIT 1')) {
      return { rows: [{ active_provider: state.activeProvider }] }
    }

    if (sql.startsWith('SELECT active_provider, settings_metadata FROM admin_ai_settings WHERE id = true LIMIT 1')) {
      return { rows: [{ active_provider: state.activeProvider, settings_metadata: state.metadata }] }
    }

    if (sql.startsWith('INSERT INTO admin_ai_settings')) {
      state.activeProvider = params[0]
      state.metadata = JSON.parse(params[1] || '{}')
      return { rowCount: 1, rows: [] }
    }

    throw new Error(`Unexpected SQL in partial model upsert test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const flags = await upsertAdminAiProviderKeys({
    payload: {
      activeProvider: 'anthropic',
      providers: {
        openai: {
          fallback: {
            model: 'gpt-4.1',
          },
        },
      },
    },
    adminId: 'admin-1',
  })

  const anthropicPrimary = state.rows.find((row) => row.provider === 'anthropic' && row.key_label === 'primary')
  const anthropicFallback = state.rows.find((row) => row.provider === 'anthropic' && row.key_label === 'fallback')
  const openaiPrimary = state.rows.find((row) => row.provider === 'openai' && row.key_label === 'primary')
  const openaiFallback = state.rows.find((row) => row.provider === 'openai' && row.key_label === 'fallback')

  assert.equal(anthropicPrimary?.model, 'claude-sonnet-4-20250514')
  assert.equal(anthropicFallback?.model, 'claude-3-5-haiku-latest')
  assert.equal(openaiPrimary?.model, 'gpt-4o-mini')
  assert.equal(openaiFallback?.model, 'gpt-4.1')
  assert.equal(flags.providers.openai.fallbackModelUpdated, true)
  assert.equal(flags.providers.openai.primaryModelUpdated, false)
  assert.equal(flags.providers.anthropic.primaryModelUpdated, false)
  assert.equal(flags.providers.anthropic.fallbackModelUpdated, false)
})
