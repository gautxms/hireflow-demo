import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./jobDescriptions.js', import.meta.url), 'utf8')

test('hard delete is dependency protected and returns 409 with usage summary', () => {
  assert.match(source, /hardDelete/)
  assert.match(source, /Hard delete blocked because this job has linked resumes or analyses\. Archive instead\./)
  assert.match(source, /return res\.status\(409\)\.json\(\{[\s\S]*usageSummary/s)
})

test('delete route computes usage summary before archive or hard delete', () => {
  assert.match(source, /SELECT COUNT\(DISTINCT r\.id\)::int AS resume_count/)
  assert.match(source, /COUNT\(pj\.id\)::int AS parse_job_count/)
  assert.match(source, /mapUsageSummary\(usageRow\)/)
})

test('schema initialization does not backfill intentionally open-ended experience ranges', () => {
  assert.match(source, /ADD COLUMN IF NOT EXISTS experience_min INTEGER/)
  assert.match(source, /ADD COLUMN IF NOT EXISTS experience_max INTEGER/)
  assert.doesNotMatch(source, /UPDATE\s+job_descriptions[\s\S]*experience_min\s*=\s*COALESCE/i)
  assert.doesNotMatch(source, /UPDATE\s+job_descriptions[\s\S]*experience_max\s*=\s*COALESCE/i)
})

test('confirmed previews use the signed-token creation path', () => {
  assert.match(source, /confirmJobDescriptionCreation\(\{[\s\S]*previewToken/)
  assert.match(source, /status\(confirmed\.created \? 201 : 200\)/)
})

test('attachment replacement detaches the original receipt before cleanup', () => {
  assert.match(source, /SET job_description_id = NULL,[\s\S]*cleanup_attempted_at = NULL/)
  assert.match(source, /Replaced attachment cleanup deferred/)
})

test('attachment references cannot be moved between accounts', () => {
  assert.match(source, /fetchJobDescriptionFile\(\{[\s\S]*fileUrl: storedFileUrl,[\s\S]*userId: req\.userId/)
  assert.match(source, /Attachment references cannot be changed directly\./)
})

test('hard deletion and duplication serialize on the source job row', () => {
  const locks = source.match(/FOR UPDATE/g) || []
  assert.ok(locks.length >= 3)
  assert.match(source, /router\.delete\('\/:id'[\s\S]*BEGIN[\s\S]*FOR UPDATE[\s\S]*DELETE FROM job_descriptions/)
  assert.match(source, /router\.post\('\/:id\/duplicate'[\s\S]*BEGIN[\s\S]*FOR UPDATE[\s\S]*INSERT INTO job_descriptions/)
})

