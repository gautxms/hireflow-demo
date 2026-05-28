import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendShortlist,
  createShortlistExportRows,
  filterShortlistCandidates,
  getAnalysisSource,
  getDecisionStatus,
  removeShortlistCandidate,
  buildShortlistExportFilename,
  buildShortlistSummary,
  getShortlistBulkErrorMessage,
  formatShortlistCandidateScore,
  getShortlistAnalysisHref,
} from './shortlistState.js'

test('shortlist create prepends and deduplicates by id', () => {
  const next = appendShortlist([{ id: '1', name: 'Existing' }], { id: '2', name: 'New' })
  assert.deepEqual(next.map((item) => item.id), ['2', '1'])
})

test('shortlist remove flow removes only the targeted resume', () => {
  const details = {
    candidates: [
      { resume_id: 'a' },
      { resume_id: 'b' },
    ],
  }

  const next = removeShortlistCandidate(details, 'b')
  assert.deepEqual(next.candidates.map((candidate) => candidate.resume_id), ['a'])
})

test('shortlist metadata fallbacks remain migration-safe for legacy rows', () => {
  const legacyCandidate = { resume_id: 'legacy-1' }
  assert.equal(getDecisionStatus(legacyCandidate), 'Unspecified')
  assert.equal(getAnalysisSource(legacyCandidate), 'Legacy / Unknown')
})

test('shortlist filters support decision status, rating, and analysis source', () => {
  const filtered = filterShortlistCandidates([
    { resume_id: '1', rating: 5, decision_status: 'advance', analysis_source: 'AI' },
    { resume_id: '2', rating: null, decision_status: 'hold', candidate_snapshot: { analysisSource: 'Manual review' } },
  ], {
    decisionStatus: 'advance',
    rating: '5',
    analysisSource: 'AI',
  })

  assert.deepEqual(filtered.map((candidate) => candidate.resume_id), ['1'])
})

test('shortlist export rows include enriched fallback fields', () => {
  const rows = createShortlistExportRows([
    { resume_id: 'abc', filename: 'resume.pdf', rating: null, notes: null },
  ])

  assert.deepEqual(rows[0], {
    resume_id: 'abc',
    filename: 'resume.pdf',
    rating: '',
    decision_status: 'Unspecified',
    analysis_source: 'Legacy / Unknown',
    notes: '',
    added_at: '',
  })
})


test('shortlist export filenames include normalized shortlist name and timestamp', () => {
  const filename = buildShortlistExportFilename('Design Team / East', 'csv')
  assert.match(filename, /^design-team-east-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.csv$/)
})


test('shortlist add summary uses shared Added/Updated/Failed copy with normalized counts', () => {
  const summary = buildShortlistSummary({ added: 2, updated: 1, invalid: 3, failed: 4 }, 'add')
  assert.equal(summary, 'Added: 2 · Updated: 1 · Failed: 7')
})

test('shortlist remove summary keeps shared Added/Updated/Failed copy with normalized counts', () => {
  const summary = buildShortlistSummary({ removed: 2, notPresent: 1, failed: 3 }, 'remove')
  assert.equal(summary, 'Added: 0 · Updated: 3 · Failed: 3')
})

test('shortlist bulk error message maps known error taxonomy codes', () => {
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'permission_error' }), /permission to update this shortlist/i)
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'missing_shortlist' }), /no longer available/i)
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'stale_selection' }), /out of date/i)
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'partial_failure' }), /could not be processed/i)
})


test('shortlist candidate score prefers original analysis score over recruiter rating', () => {
  const display = formatShortlistCandidateScore({
    rating: 4,
    candidate_snapshot: { score: 86 },
  })

  assert.equal(display.label, 'Score: 8.6/10')
})



test('shortlist candidate score normalizes 100-point and 10-point analysis scores', () => {
  assert.equal(formatShortlistCandidateScore({ candidate_snapshot: { score: 82 } }).label, 'Score: 8.2/10')
  assert.equal(formatShortlistCandidateScore({ candidate_snapshot: { score: 8.2 } }).label, 'Score: 8.2/10')
})

test('shortlist candidate score falls back to enriched AI score fields, not legacy recruiter rating', () => {
  assert.equal(formatShortlistCandidateScore({ resume_id: 'old' }).label, 'Score unavailable')
  assert.equal(formatShortlistCandidateScore({ rating: 4 }).label, 'Score unavailable')
  assert.equal(formatShortlistCandidateScore({ score: 74 }).label, 'Score: 7.4/10')
  assert.equal(formatShortlistCandidateScore({ profileScore: 91 }).label, 'Score: 9.1/10')
})

test('shortlist analysis href resolves linked analysis from saved or enriched score context', () => {
  assert.equal(getShortlistAnalysisHref({ score_analysis_id: 'score-analysis-1' }), '/analyses/score-analysis-1')
  assert.equal(getShortlistAnalysisHref({ source_context: { analysisId: 'analysis 123' } }), '/analyses/analysis%20123')
  assert.equal(getShortlistAnalysisHref({ candidate_snapshot: { sourceAnalysisId: 'abc' } }), '/analyses/abc')
  assert.equal(getShortlistAnalysisHref({ rating: 4 }), '')
})
