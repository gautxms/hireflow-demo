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
