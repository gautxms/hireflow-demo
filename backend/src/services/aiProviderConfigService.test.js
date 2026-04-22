import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import { syncProviderModelRegistry, validateAiProviderModelConfiguration } from './aiProviderConfigService.js'

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
