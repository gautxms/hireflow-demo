import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import {
  alignAdminAiUserReferenceColumns,
  getCastExpression,
  normalizeTypeName,
  verifyAdminAiUserReferenceCompatibility,
} from './adminAiSchemaCompatibility.js'

const ADMIN_COLUMNS = [
  { table: 'admin_system_prompts', column: 'updated_by' },
  { table: 'admin_ai_provider_keys', column: 'created_by' },
  { table: 'admin_ai_provider_keys', column: 'updated_by' },
  { table: 'admin_ai_settings', column: 'updated_by' },
]

const originalConnect = pool.connect.bind(pool)

function createMockClient({ usersIdType = 'text', existingColumns = null } = {}) {
  const columns = new Map()
  const fks = new Map()

  for (const { table, column } of ADMIN_COLUMNS) {
    const key = `${table}.${column}`
    const initialType = existingColumns?.get(key) ?? 'integer'
    columns.set(key, initialType)
    fks.set(key, false)
  }

  return {
    client: {
      query: async (queryText, params = []) => {
        const sql = String(queryText).trim().replace(/\s+/g, ' ')

        if (sql.includes('SELECT format_type(a.atttypid, a.atttypmod) AS data_type')) {
          return { rows: [{ data_type: usersIdType }] }
        }

        if (sql.startsWith('SELECT data_type, udt_name FROM information_schema.columns')) {
          const [table, column] = params
          const key = `${table}.${column}`
          if (!columns.has(key)) return { rows: [] }
          const type = columns.get(key)
          if (type === 'varchar') {
            return { rows: [{ data_type: 'character varying', udt_name: 'varchar' }] }
          }
          if (type === 'text') {
            return { rows: [{ data_type: 'text', udt_name: 'text' }] }
          }
          if (type === 'uuid') {
            return { rows: [{ data_type: 'uuid', udt_name: 'uuid' }] }
          }
          if (type === 'bigint') {
            return { rows: [{ data_type: 'bigint', udt_name: 'int8' }] }
          }
          return { rows: [{ data_type: 'integer', udt_name: 'int4' }] }
        }

        if (sql.startsWith('SELECT tc.constraint_name FROM information_schema.table_constraints tc')) {
          const [table, column] = params
          const key = `${table}.${column}`
          if (!columns.has(key) || !fks.get(key)) {
            return { rows: [] }
          }
          return { rows: [{ constraint_name: `fk_${table}_${column}_users_id` }] }
        }

        if (sql.startsWith('ALTER TABLE') && sql.includes('DROP CONSTRAINT IF EXISTS')) {
          return { rows: [] }
        }

        if (sql.startsWith('ALTER TABLE') && sql.includes('ALTER COLUMN') && sql.includes(' TYPE ')) {
          const tableMatch = sql.match(/^ALTER TABLE ([a-z_]+)/)
          const columnMatch = sql.match(/ALTER COLUMN ([a-z_]+) TYPE ([a-z]+)/)
          const table = tableMatch?.[1]
          const column = columnMatch?.[1]
          const targetType = columnMatch?.[2]
          if (table && column && targetType) {
            columns.set(`${table}.${column}`, targetType)
            fks.set(`${table}.${column}`, false)
          }
          return { rows: [] }
        }

        if (sql.startsWith('ALTER TABLE') && sql.includes('ADD CONSTRAINT') && sql.includes('FOREIGN KEY')) {
          const tableMatch = sql.match(/^ALTER TABLE ([a-z_]+)/)
          const columnMatch = sql.match(/FOREIGN KEY \(([a-z_]+)\)/)
          const table = tableMatch?.[1]
          const column = columnMatch?.[1]
          if (table && column) {
            fks.set(`${table}.${column}`, true)
          }
          return { rows: [] }
        }

        if (sql.startsWith('SELECT 1 FROM information_schema.table_constraints tc')) {
          const [table, column] = params
          const key = `${table}.${column}`
          return { rows: fks.get(key) ? [{ '?column?': 1 }] : [] }
        }

        throw new Error(`Unexpected SQL in adminAiSchemaCompatibility.test: ${sql}`)
      },
      release() {},
    },
  }
}

test.after(() => {
  pool.connect = originalConnect
})

test('normalizeTypeName accepts text-like and numeric/uuid variants', () => {
  assert.equal(normalizeTypeName('text'), 'text')
  assert.equal(normalizeTypeName('character varying'), 'text')
  assert.equal(normalizeTypeName('varchar'), 'text')
  assert.equal(normalizeTypeName('bpchar'), 'text')
  assert.equal(normalizeTypeName('uuid'), 'uuid')
  assert.equal(normalizeTypeName('int4'), 'integer')
  assert.equal(normalizeTypeName('integer'), 'integer')
  assert.equal(normalizeTypeName('int8'), 'bigint')
})

test('getCastExpression supports text target and preserves existing numeric/uuid behavior', () => {
  const toText = getCastExpression('updated_by', 'text')
  assert.match(toText, /updated_by::text/)
  assert.doesNotMatch(toText, /\^\[0-9a-f\]/)

  const toUuid = getCastExpression('updated_by', 'uuid')
  assert.match(toUuid, /~\* '\^\[0-9a-f\]/)

  const toInteger = getCastExpression('updated_by', 'integer')
  assert.match(toInteger, /::integer/)
  assert.match(toInteger, /\^-\?\[0-9\]\+\$/)
})

test('align + verify flow is non-throwing and healthy for text users.id schemas', async () => {
  const { client } = createMockClient({ usersIdType: 'text' })
  pool.connect = async () => client

  const alignment = await alignAdminAiUserReferenceColumns()
  assert.equal(alignment.usersIdType, 'text')
  assert.equal(alignment.alignedColumns.length, ADMIN_COLUMNS.length)

  const health = await verifyAdminAiUserReferenceCompatibility()
  assert.equal(health.ok, true)
  assert.equal(health.usersIdType, 'text')
  assert.deepEqual(health.issues, [])
})
