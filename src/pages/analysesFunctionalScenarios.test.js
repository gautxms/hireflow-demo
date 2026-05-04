import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const analysesPageSource = readFileSync(new URL('./AnalysesPage.jsx', import.meta.url), 'utf8')
const analysisDetailSource = readFileSync(new URL('./AnalysisDetailPage.jsx', import.meta.url), 'utf8')

test('create-analysis modal supports open, close, submit, and validation states', () => {
  assert.match(analysesPageSource, /setIsModalOpen\(true\)/)
  assert.match(analysesPageSource, /setIsModalOpen\(false\)/)
  assert.match(analysesPageSource, /if \(event\.key === 'Escape' && !isSubmitting\) resetModal\(\)/)
  assert.match(analysesPageSource, /<form onSubmit=\{handleSubmit\}/)
  assert.match(analysesPageSource, /Give this analysis a name so you can find it later\./)
  assert.match(analysesPageSource, /Add at least one resume file to continue\./)
  assert.match(analysesPageSource, /if \(nextValidationErrors\.name \|\| nextValidationErrors\.files\) return/)
})

test('analyses list page includes loading, empty, and populated rendering branches', () => {
  assert.match(analysesPageSource, /\{loading && <p>Loading analyses…<\/p>\}/)
  assert.match(analysesPageSource, /No analyses yet\. Upload resumes to create your first run\./)
  assert.match(analysesPageSource, /sortedItems\.length > 0 && \(/)
  assert.match(analysesPageSource, /<table className="analyses-layout__table">/)
})

test('analysis detail page renders complete terminal flow to CandidateResults', () => {
  assert.match(analysisDetailSource, /if \(isCompletedTerminalState\) \{[\s\S]*<CandidateResults/)
})

test('analysis detail page renders failed state messaging and failure overview section', () => {
  assert.match(analysisDetailSource, /const hasFailures = liveStatus === 'failed' \|\| failedCount > 0/)
  assert.match(analysisDetailSource, /Failure Overview/)
  assert.match(analysisDetailSource, /terminal failures \(or a mixed completion with failures\)/)
})

test('analysis detail page renders processing state note while run is in progress', () => {
  assert.match(analysisDetailSource, /\(liveStatus === 'pending' \|\| liveStatus === 'processing'\)/)
  assert.match(analysisDetailSource, /This analysis is still running\. Statuses refresh automatically every few seconds\./)
})
