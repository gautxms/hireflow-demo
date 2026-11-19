import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { up } from './058-add-google-auth-identities.js'

test('migration runner includes Google identities after MCP OAuth', async () => {
  const source = await readFile(new URL('./runner.js', import.meta.url), 'utf8')
  assert.ok(source.indexOf("'057-add-mcp-oauth'") < source.indexOf("'058-add-google-auth-identities'"))
})

test('Google identity migration is additive and keeps password login enabled by default', async () => {
  const statements = []
  await up({ async query(sql) { statements.push(String(sql)) } })
  const sql = statements.join('\n')
  assert.equal(statements.length, 2)
  assert.match(sql, /password_login_enabled BOOLEAN NOT NULL DEFAULT true/)
  assert.match(sql, /terms_accepted_at TIMESTAMPTZ/)
  assert.match(sql, /terms_version TEXT/)
  assert.match(sql, /user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(sql, /UNIQUE \(provider, provider_subject\)/)
  assert.match(sql, /UNIQUE \(user_id, provider\)/)
  assert.doesNotMatch(sql, /ALTER COLUMN password_hash|DROP COLUMN|UPDATE users/)
})

test('Google identities preserve legacy users, enforce uniqueness, and cascade on deletion', {
  skip: !process.env.GOOGLE_AUTH_SCHEMA_TEST_DATABASE_URL,
}, async () => {
  const { Client } = await import('pg')
  const db = new Client({ connectionString: process.env.GOOGLE_AUTH_SCHEMA_TEST_DATABASE_URL })
  const schema = `google_auth_${randomUUID().replaceAll('-', '')}`
  await db.connect()

  try {
    await db.query('BEGIN')
    await db.query(`CREATE SCHEMA ${schema}`)
    await db.query(`SET LOCAL search_path TO ${schema}, public`)
    await db.query('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL)')
    const legacy = await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [
      'legacy@example.com', 'legacy-password-hash',
    ])

    await up(db)
    await up(db)
    const user = await db.query('SELECT password_hash, password_login_enabled, terms_accepted_at, terms_version FROM users WHERE id = $1', [legacy.rows[0].id])
    assert.deepEqual(user.rows[0], {
      password_hash: 'legacy-password-hash',
      password_login_enabled: true,
      terms_accepted_at: null,
      terms_version: null,
    })

    await db.query('INSERT INTO user_auth_identities (user_id, provider, provider_subject, provider_email) VALUES ($1, $2, $3, $4)', [
      legacy.rows[0].id, 'google', 'stable-google-sub', 'legacy@example.com',
    ])
    const second = await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [
      'second@example.com', 'second-password-hash',
    ])
    await db.query('SAVEPOINT duplicate_identity')
    await assert.rejects(
      db.query('INSERT INTO user_auth_identities (user_id, provider, provider_subject, provider_email) VALUES ($1, $2, $3, $4)', [
        second.rows[0].id, 'google', 'stable-google-sub', 'second@example.com',
      ]),
      { code: '23505' },
    )
    await db.query('ROLLBACK TO SAVEPOINT duplicate_identity')

    await db.query('SAVEPOINT duplicate_user_provider')
    await assert.rejects(
      db.query('INSERT INTO user_auth_identities (user_id, provider, provider_subject, provider_email) VALUES ($1, $2, $3, $4)', [
        legacy.rows[0].id, 'google', 'another-google-sub', 'legacy@example.com',
      ]),
      { code: '23505' },
    )
    await db.query('ROLLBACK TO SAVEPOINT duplicate_user_provider')

    await db.query('DELETE FROM users WHERE id = $1', [legacy.rows[0].id])
    const orphan = await db.query('SELECT id FROM user_auth_identities WHERE provider_subject = $1', ['stable-google-sub'])
    assert.equal(orphan.rowCount, 0)
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
})
