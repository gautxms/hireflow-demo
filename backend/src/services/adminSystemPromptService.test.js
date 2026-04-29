import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import {
  DEFAULT_SYSTEM_PROMPT,
  resetAdminSystemPromptToDefault,
  upsertAdminSystemPrompt,
} from './adminSystemPromptService.js'

const originalQuery = pool.query.bind(pool)

test.after(() => {
  pool.query = originalQuery
})

test('upsertAdminSystemPrompt update path binds SQL placeholders to the correct parameters', async () => {
  const calls = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')
    calls.push({ sql, params })

    if (sql.includes('SELECT format_type(a.atttypid, a.atttypmod) AS data_type')) {
      return { rows: [{ data_type: 'text' }] }
    }

    if (sql.startsWith('CREATE TABLE IF NOT EXISTS admin_system_prompts')) {
      return { rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_system_prompts (id, system_prompt, prompt_version)')) {
      return { rows: [] }
    }

    if (sql.startsWith('UPDATE admin_system_prompts')) {
      assert.match(sql, /SET system_prompt = \$1/i)
      assert.match(sql, /updated_by = \$2/i)
      assert.deepEqual(params, ['Updated prompt', 'admin-42'])
      return {
        rows: [{
          system_prompt: 'Updated prompt',
          prompt_version: 7,
          updated_by: 'admin-42',
          created_at: '2026-04-20T00:00:00.000Z',
          updated_at: '2026-04-22T00:00:00.000Z',
        }],
      }
    }

    throw new Error(`Unexpected SQL in adminSystemPromptService.test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const result = await upsertAdminSystemPrompt({
    systemPrompt: ' Updated prompt ',
    adminId: 'admin-42',
  })

  assert.equal(result.systemPrompt, 'Updated prompt')
  assert.equal(result.promptVersion, 7)
  assert.equal(result.updatedBy, 'admin-42')

  const updateCall = calls.find((entry) => entry.sql.startsWith('UPDATE admin_system_prompts'))
  assert.deepEqual(updateCall?.params, ['Updated prompt', 'admin-42'])
})

test('upsertAdminSystemPrompt falls back to insert when update does not find a row', async () => {
  const calls = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')
    calls.push({ sql, params })

    if (sql.startsWith('UPDATE admin_system_prompts')) {
      assert.deepEqual(params, ['Fresh prompt', null])
      return { rows: [] }
    }

    if (sql.startsWith('INSERT INTO admin_system_prompts (id, system_prompt, prompt_version, updated_by)')) {
      assert.deepEqual(params, ['Fresh prompt', null])
      return {
        rows: [{
          system_prompt: 'Fresh prompt',
          prompt_version: 1,
          updated_by: null,
          created_at: '2026-04-22T00:00:00.000Z',
          updated_at: '2026-04-22T00:00:00.000Z',
        }],
      }
    }

    throw new Error(`Unexpected SQL in fallback adminSystemPromptService.test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const result = await upsertAdminSystemPrompt({
    systemPrompt: 'Fresh prompt',
    adminId: '',
  })

  assert.equal(result.promptVersion, 1)
  assert.equal(result.updatedBy, null)

  const updateCall = calls.find((entry) => entry.sql.startsWith('UPDATE admin_system_prompts'))
  const insertCall = calls.find((entry) => entry.sql.startsWith('INSERT INTO admin_system_prompts (id, system_prompt, prompt_version, updated_by)'))
  assert.ok(updateCall)
  assert.ok(insertCall)
})

test('resetAdminSystemPromptToDefault persists the known default prompt', async () => {
  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim().replace(/\s+/g, ' ')

    if (sql.startsWith('UPDATE admin_system_prompts')) {
      assert.deepEqual(params, [DEFAULT_SYSTEM_PROMPT, 'admin-reset'])
      return {
        rows: [{
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          prompt_version: 9,
          updated_by: 'admin-reset',
          created_at: '2026-04-20T00:00:00.000Z',
          updated_at: '2026-04-22T00:00:00.000Z',
        }],
      }
    }

    throw new Error(`Unexpected SQL in reset adminSystemPromptService.test: ${sql} | params=${JSON.stringify(params)}`)
  }

  const result = await resetAdminSystemPromptToDefault({ adminId: 'admin-reset' })

  assert.equal(result.systemPrompt, DEFAULT_SYSTEM_PROMPT)
  assert.equal(result.promptVersion, 9)
})
