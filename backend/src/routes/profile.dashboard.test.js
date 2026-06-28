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


test('dashboard KPI payload exposes filtered resume analysis count', () => {
  assert.match(profileRouteSource, /const resumesCount = Number\(summary\.resumes_count \|\| 0\)/)
  assert.match(profileRouteSource, /resumesAnalyzedCount: resumesCount/)
})

test('dashboard monthly resume usage counts analysis items for current calendar month', () => {
  assert.match(profileRouteSource, /monthlyUsageResult/)
  assert.match(profileRouteSource, /FROM analysis_items ai\s+INNER JOIN analyses a ON a\.id = ai\.analysis_id/)
  assert.match(profileRouteSource, /a\.created_at >= date_trunc\('month', NOW\(\)\)/)
  assert.match(profileRouteSource, /a\.created_at < date_trunc\('month', NOW\(\)\) \+ interval '1 month'/)
  assert.match(profileRouteSource, /monthlyResumeAnalysisRemaining = Math\.max\(monthlyResumeAnalysisLimit - monthlyResumeAnalysisCount, 0\)/)
  assert.match(profileRouteSource, /monthlyResumeAnalysisUsageRate = formatRate\(monthlyResumeAnalysisCount, monthlyResumeAnalysisLimit\)/)
})

test('dashboard monthly resume usage uses one analysis item as one resume analysis unit', () => {
  assert.match(profileRouteSource, /SELECT COUNT\(\*\)::int AS monthly_resume_analysis_count\s+FROM analysis_items ai/)
  assert.doesNotMatch(profileRouteSource, /monthly_resume_analysis_count[\s\S]*COUNT\(DISTINCT a\.id\)/)
})

test('dashboard CSV export includes resume analysis count and monthly usage fields', () => {
  for (const key of [
    'resumes_analyzed_count',
    'monthly_resume_analysis_count',
    'monthly_resume_analysis_limit',
    'monthly_resume_analysis_remaining',
    'monthly_resume_analysis_usage_rate',
  ]) {
    assert.match(profileRouteSource, new RegExp(key))
  }
})
