import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import { validateAiProviderModelConfiguration } from './aiProviderConfigService.js'

const originalQuery = pool.query.bind(pool)

test.after(() => {
  pool.query = originalQuery
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
