import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { up } from './056-add-job-description-creation-requests.js'

test('migration runner includes confirmed job creation after subscription migrations', async () => {
  const source = await readFile(new URL('./runner.js', import.meta.url), 'utf8')
  assert.match(source, /'056-add-job-description-creation-requests'/)
  assert.ok(
    source.indexOf("'055-allow-tiered-subscription-plans'")
      < source.indexOf("'056-add-job-description-creation-requests'"),
  )
})

test('confirmed job creation migration enforces one job per account preview', async () => {
  const queries = []
  await up({ async query(sql) { queries.push(String(sql)); return { rows: [] } } })
  const sql = queries.join('\n')

  assert.equal(queries.length, 2)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS job_description_creation_requests/)
  assert.match(sql, /UNIQUE \(user_id, preview_id\)/)
  assert.match(sql, /file_sha256 TEXT NOT NULL CHECK/)
  assert.match(sql, /preview_sha256 TEXT NOT NULL CHECK/)
  assert.match(sql, /job_description_id UUID REFERENCES job_descriptions\(id\) ON DELETE SET NULL/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_job_description_creation_requests_job/)
})
