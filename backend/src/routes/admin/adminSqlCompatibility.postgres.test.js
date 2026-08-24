import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { ADMIN_RETENTION_COHORT_QUERY } from './analytics.js'
import {
  ADMIN_AUDIT_TRAIL_QUERY,
  ERROR_LOGS_LIST_QUERY,
} from './logs.js'

const { Pool } = pg
const databaseUrl = process.env.ADMIN_CONSOLE_POSTGRES_TEST_DATABASE_URL
const postgresTest = databaseUrl ? test : test.skip
const db = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null

test.after(async () => {
  await db?.end()
})

async function withTemporaryTables(callback) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await callback(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

test('admin query sources avoid PostgreSQL-incompatible aggregate and date expressions', () => {
  assert.doesNotMatch(ERROR_LOGS_LIST_QUERY, /COUNT\s*\(\s*DISTINCT\s+NULLIF/i)
  assert.doesNotMatch(ADMIN_RETENTION_COHORT_QUERY, /EXTRACT\s*\([^)]*FROM\s*\([^)]*-[^)]*\)\)/i)
  assert.match(ADMIN_AUDIT_TRAIL_QUERY, /\$1::text\[\]\s+IS\s+NULL/i)
})

postgresTest('error log listing executes on PostgreSQL and tolerates malformed resolved metadata', async () => {
  await withTemporaryTables(async (client) => {
    await client.query(`
      CREATE TEMP TABLE error_logs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        context JSONB,
        created_at TIMESTAMPTZ NOT NULL
      ) ON COMMIT DROP
    `)
    await client.query(
      `INSERT INTO error_logs (id, source, message, context, created_at)
       VALUES
         ('log-1', 'subscriptions.cancel.failed', 'Provider state unverified', $1::jsonb, '2026-08-24T10:00:00Z'),
         ('log-2', 'subscriptions.cancel.failed', 'Provider state unverified', $2::jsonb, '2026-08-24T10:01:00Z'),
         ('log-3', 'subscriptions.cancel.failed', 'Provider state unverified', $3::jsonb, '2026-08-24T10:02:00Z')`,
      [
        JSON.stringify({ endpoint: '/subscriptions/cancel', statusCode: 502, userId: 11, resolved: 'invalid' }),
        JSON.stringify({ endpoint: '/subscriptions/cancel', statusCode: 502, userId: 12 }),
        JSON.stringify({ endpoint: '/subscriptions/cancel', statusCode: 502, userId: 12, resolved: true }),
      ],
    )

    const result = await client.query(ERROR_LOGS_LIST_QUERY, [
      '2026-08-24T00:00:00Z',
      '2026-08-25T00:00:00Z',
      'Provider state',
      '/subscriptions/cancel',
      '502',
      20,
      0,
    ])

    assert.equal(result.rowCount, 3)
    assert.equal(Number(result.rows[0].total_count), 3)
    assert.ok(result.rows.every((row) => Number(row.affected_users) === 2))
    assert.equal(result.rows.find((row) => row.id === 'log-1').resolved, false)
    assert.equal(result.rows.find((row) => row.id === 'log-3').resolved, true)
  })
})

postgresTest('admin audit filtering uses one consistent PostgreSQL array parameter type', async () => {
  await withTemporaryTables(async (client) => {
    await client.query(`
      CREATE TEMP TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      ) ON COMMIT DROP;
      CREATE TEMP TABLE admin_actions (
        id TEXT PRIMARY KEY,
        admin_id INTEGER,
        action_type TEXT NOT NULL,
        target_id TEXT,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL
      ) ON COMMIT DROP
    `)
    await client.query(`
      INSERT INTO users (id, email) VALUES (1, 'admin@example.com');
      INSERT INTO admin_actions (id, admin_id, action_type, created_at)
      VALUES
        ('action-1', 1, 'admin_ai_settings_updated', '2026-08-24T10:00:00Z'),
        ('action-2', 1, 'unrelated_action', '2026-08-24T10:01:00Z')
    `)

    const filtered = await client.query(ADMIN_AUDIT_TRAIL_QUERY, [
      ['admin_ai_settings_updated'],
      '',
      20,
      0,
    ])
    assert.deepEqual(filtered.rows.map((row) => row.id), ['action-1'])

    const unfiltered = await client.query(ADMIN_AUDIT_TRAIL_QUERY, [null, '', 20, 0])
    assert.equal(unfiltered.rowCount, 2)
  })
})

postgresTest('admin retention cohorts calculate whole week offsets from PostgreSQL date differences', async () => {
  await withTemporaryTables(async (client) => {
    await client.query(`
      CREATE TEMP TABLE users (
        id INTEGER PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL
      ) ON COMMIT DROP;
      CREATE TEMP TABLE events (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        timestamp TIMESTAMPTZ NOT NULL
      ) ON COMMIT DROP
    `)
    await client.query(`
      INSERT INTO users (id, created_at) VALUES (1, '2026-01-06T10:00:00Z');
      INSERT INTO events (id, user_id, timestamp)
      VALUES
        ('event-1', 1, '2026-01-07T10:00:00Z'),
        ('event-2', 1, '2026-01-20T10:00:00Z')
    `)

    const result = await client.query(ADMIN_RETENTION_COHORT_QUERY, [
      '2026-01-01',
      '2026-01-31',
    ])

    assert.deepEqual(
      result.rows.map((row) => ({
        weekOffset: row.week_offset,
        retainedUsers: row.retained_users,
      })),
      [
        { weekOffset: 0, retainedUsers: 1 },
        { weekOffset: 2, retainedUsers: 1 },
      ],
    )
  })
})
