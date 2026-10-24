import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { up } from './057-add-mcp-oauth.js'

test('migration runner adds MCP OAuth storage after confirmed job creation', async () => {
  const source = await readFile(new URL('./runner.js', import.meta.url), 'utf8')
  assert.match(source, /'057-add-mcp-oauth'/)
  assert.ok(
    source.indexOf("'056-add-job-description-creation-requests'")
      < source.indexOf("'057-add-mcp-oauth'"),
  )
})

test('MCP OAuth migration creates stable profiles and hashed credential storage', async () => {
  const queries = []
  await up({ async query(sql) { queries.push(String(sql)); return { rows: [] } } })
  const sql = queries.join('\n')

  assert.equal(queries.length, 9)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS mcp_profile_id UUID DEFAULT gen_random_uuid\(\)/)
  assert.match(sql, /ALTER COLUMN mcp_profile_id SET NOT NULL/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mcp_profile_id/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes/)
  assert.match(sql, /code_hash TEXT PRIMARY KEY/)
  assert.match(sql, /code_challenge_method TEXT NOT NULL CHECK \(code_challenge_method = 'S256'\)/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mcp_oauth_tokens/)
  assert.match(sql, /access_token_hash TEXT NOT NULL UNIQUE/)
  assert.match(sql, /refresh_token_hash TEXT NOT NULL UNIQUE/)
  assert.doesNotMatch(sql, /access_token TEXT/)
  assert.doesNotMatch(sql, /refresh_token TEXT/)
})
