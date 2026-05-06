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

test('analyses list page provides conditional and keyboard-accessible pagination controls', () => {
  assert.match(analysesPageSource, /shouldRenderPaginationControls && \(/)
  assert.match(analysesPageSource, /<nav aria-label="Analyses pagination">/)
  assert.match(analysesPageSource, /aria-label="Previous analyses page"/)
  assert.match(analysesPageSource, /aria-label="Next analyses page"/)
  assert.match(analysesPageSource, /<span aria-live="polite">Page \{currentPage\} of \{totalPages\}<\/span>/)
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

test('analysis detail page renders normalization drop warning only for non-production and dropped candidates', () => {
  assert.match(analysisDetailSource, /const isNonProductionBuild = \(\(\) =>/)
  assert.match(analysisDetailSource, /process\.env\.NODE_ENV !== 'production'/)
  assert.match(analysisDetailSource, /isNonProductionBuild && candidateResultsPayload\.droppedCount > 0/)
  assert.match(analysisDetailSource, /Dev warning: dropped \{candidateResultsPayload\.droppedCount\} of \{candidateResultsPayload\.inputCount\} incoming candidates during normalization\./)
  assert.match(analysisDetailSource, /Inspect logs for analysisId \{analysisId \|\| '—'\}\./)
})

test('status alias mapping stays consistent across analyses list and detail views', () => {
  assert.match(analysesPageSource, /queued:\s*'pending'/)
  assert.match(analysesPageSource, /retrying:\s*'processing'/)
  assert.match(analysisDetailSource, /queued:\s*'pending'/)
  assert.match(analysisDetailSource, /retrying:\s*'processing'/)
})

test('summary bucket labels and counts are aligned across analyses list and detail views', () => {
  assert.match(analysesPageSource, /Summary<\/th>/)
  assert.match(analysesPageSource, /Total \{summary\.total \|\| 0\} · Complete \{summary\.complete \|\| 0\} · Failed \{summary\.failed \|\| 0\} · Processing \{summary\.processing \|\| 0\} · Pending \{summary\.pending \|\| 0\}/)
  assert.match(analysisDetailSource, /Summary — Total \{summary\.total \|\| 0\} · Complete \{completeCount\} · Failed \{failedCount\} · Processing \{summary\.processing \|\| 0\} · Pending \{summary\.pending \|\| 0\}/)
})

test('analyses list links complete and partial rows while leaving pending and processing non-clickable', () => {
  assert.match(analysesPageSource, /const isNavigable = status === 'complete' \|\| status === 'completed' \|\| status === 'partial'/)
  assert.match(analysesPageSource, /\{isNavigable \? \(/)
  assert.match(analysesPageSource, /<a href=\{`\/analyses\/\$\{analysis\.id\}`\}>\{analysis\.name \|\| 'Untitled analysis'\}<\/a>/)
  assert.match(analysesPageSource, /const helperLabel = status === 'failed' \? 'Failed' : status === 'processing' \? 'Processing' : 'Results not ready'/)
})
