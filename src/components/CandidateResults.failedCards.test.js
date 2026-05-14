import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const candidateResultsSource = readFileSync(new URL('./CandidateResults.jsx', import.meta.url), 'utf8')
const analysisDetailSource = readFileSync(new URL('../pages/AnalysisDetailPage.jsx', import.meta.url), 'utf8')

test('failed resume cards render deterministic filename, category, and action copy', () => {
  assert.match(candidateResultsSource, /toDisplayText\(item\?\.filename, 'Unknown file'\)/)
  assert.match(candidateResultsSource, /toDisplayText\(item\?\.resumeProcessingStatus, 'parse_failed'\)/)
  assert.match(candidateResultsSource, /toDisplayText\(item\?\.parseError \|\| item\?\.reason, 'Resume processing failed'\)/)
  assert.match(candidateResultsSource, /Next action:/)
  assert.match(candidateResultsSource, /resume\$\{failedResumes\.length === 1 \? '' : 's'\} need attention/)
})

test('analysis detail summary banner uses deterministic complete failed processing and pending counters', () => {
  assert.match(analysisDetailSource, /Summary — Total \{summary\.total \|\| 0\} · Complete \{summary\.complete \|\| 0\} · Failed \{failedCount\} · Processing \{summary\.processing \|\| 0\} · Pending \{summary\.pending \|\| 0\}/)
})


test('analysis detail preserves lifecycle summary while candidate results keeps data quality messaging', () => {
  assert.match(analysisDetailSource, /Summary — Total \{summary\.total \|\| 0\} · Complete \{summary\.complete \|\| 0\} · Failed \{failedCount\} · Processing \{summary\.processing \|\| 0\} · Pending \{summary\.pending \|\| 0\}/)
  assert.match(candidateResultsSource, /Data quality: Some fields could not be extracted from this resume format\./)
  assert.doesNotMatch(candidateResultsSource, /Unknown Candidate/)
})
