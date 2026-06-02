import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const analysesPageSource = readFileSync(new URL('./AnalysesPage.jsx', import.meta.url), 'utf8')
const analysisDetailSource = readFileSync(new URL('./AnalysisDetailPage.jsx', import.meta.url), 'utf8')

test('create-analysis modal supports open, close, submit, and validation states', () => {
  assert.match(analysesPageSource, /setIsCreateModalOpen\(true\)/)
  assert.match(analysesPageSource, /setIsCreateModalOpen\(false\)/)
  assert.match(analysesPageSource, /if \(event\.key === 'Escape' && !isSubmitting\) \{[\s\S]*onClose\(\)/)
  assert.match(analysesPageSource, /<form onSubmit=\{onSubmit\}/)
  assert.match(analysesPageSource, /Give this analysis a name so you can find it later\./)
  assert.match(analysesPageSource, /Add at least one resume file to continue\./)
  assert.match(analysesPageSource, /if \(nextValidationErrors\.name \|\| nextValidationErrors\.files\) return/)
})

test('analyses list page includes loading, empty, and populated rendering branches', () => {
  assert.match(analysesPageSource, /Loading analyses…/)
  assert.match(analysesPageSource, /No analyses yet\. Upload resumes to create your first run\./)
  assert.match(analysesPageSource, /sortedItems\.length > 0 && \(/)
  assert.match(analysesPageSource, /<table className="analyses-layout__table">/)
})

test('analyses list page provides conditional and keyboard-accessible pagination controls', () => {
  assert.match(analysesPageSource, /shouldRenderPaginationControls && \(/)
  assert.match(analysesPageSource, /aria-label="Analyses pagination"/)
  assert.match(analysesPageSource, /Previous/)
  assert.match(analysesPageSource, /Next/)
  assert.match(analysesPageSource, /Page \{currentPage\} of \{totalPages\}/)
})

test('analysis detail page renders terminal flow to CandidateResults while keeping partial failures visible', () => {
  assert.match(analysisDetailSource, /displayStatus === 'complete'/)
  assert.match(analysisDetailSource, /displayStatus === 'partial'/)
  assert.match(analysisDetailSource, /<CandidateResults/)
  assert.match(analysisDetailSource, /<FailedFilesSection items=\{analysisItems\} \/>/)
  assert.match(analysisDetailSource, /<AnalysisItemsTable items=\{analysisItems\} \/>/)
})

test('analysis detail page renders failed state messaging and sanitized failed file section', () => {
  assert.match(analysisDetailSource, /displayStatus === 'failed'/)
  assert.match(analysisDetailSource, /This analysis failed before results were finalized\./)
  assert.match(analysisDetailSource, /toSafeResumeFailureReason\(item\?\.error/)
  assert.match(analysisDetailSource, /Review the failed file below/)
})

test('analysis detail page renders processing state note while run is in progress', () => {
  assert.match(analysisDetailSource, /This analysis is still processing\. Results will be available when processing completes\./)
  assert.match(analysisDetailSource, /Current status: <strong>\{displayStatus\}<\/strong>/)
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

test('summary bucket labels and partial counts are aligned across analyses list and detail views', () => {
  assert.match(analysesPageSource, /<dt>Total<\/dt><dd>\{Number\(summary\.total \|\| 0\)\}<\/dd>/)
  assert.match(analysesPageSource, /Partial results: \$\{complete\} of \$\{total\} resumes analysed, \$\{failed\} failed\./)
  assert.match(analysesPageSource, /<p id=\{`\$\{popoverId\}-partial-detail`\} className="analyses-status-summary__detail">\{partialSummary\}<\/p>/)
  assert.match(analysesPageSource, /aria-label=\{partialSummary \? 'View partial analysis details' : 'View analysis status details'\}/)
  assert.match(analysesPageSource, /aria-describedby=\{isOpen && partialSummary \? `\$\{popoverId\}-partial-detail` : undefined\}/)
  assert.doesNotMatch(analysesPageSource, /analyses-layout__partial-copy/)
  assert.doesNotMatch(analysesPageSource, /status === 'partial' && <span/)
  assert.match(analysisDetailSource, /Partial results: \$\{complete\} of \$\{total\} resumes were analysed\./)
  assert.match(analysisDetailSource, /Summary — Total \{summary\.total \|\| 0\} · Complete \{completeCount\} · Failed \{failedCount\}/)
})

test('analyses list links complete and partial rows while leaving pending and processing non-clickable', () => {
  assert.match(analysesPageSource, /const isNavigable = status === 'complete' \|\| status === 'completed' \|\| status === 'partial'/)
  assert.match(analysesPageSource, /\{isNavigable \? \(/)
  assert.match(analysesPageSource, /href=\{`\/analyses\/\$\{analysis\.id\}`\}/)
  assert.match(analysesPageSource, /analysis\.name \|\| 'Untitled analysis'/)
})
