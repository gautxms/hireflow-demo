import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const profileRouteSource = readFileSync(new URL('./profile.js', import.meta.url), 'utf8')

test('dashboard score averages only include completed analyses with valid scores', () => {
  assert.match(profileRouteSource, /completed_scored_resume_window AS \(/)
  assert.match(profileRouteSource, /aw\.status = 'complete'/)
  assert.match(profileRouteSource, /fai\.status = 'complete'/)
  assert.match(profileRouteSource, /r\.profile_score IS NOT NULL/)
})

test('dashboard score trend preserves missing score buckets as null instead of zero', () => {
  assert.match(profileRouteSource, /avgScore = scoreCount > 0[\s\S]*: null/)
  assert.match(profileRouteSource, /avgScore: Number\.isFinite\(avgScore\) \? avgScore : null/)
  assert.match(profileRouteSource, /value: row\.avgScore,[\s\S]*scoredCount: row\.scoreCount/)
  assert.doesNotMatch(profileRouteSource, /avgScore: Number\(row\.avg_score \|\| 0\)/)
})
