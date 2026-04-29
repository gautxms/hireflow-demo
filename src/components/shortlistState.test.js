import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendShortlist,
  createShortlistExportRows,
  filterShortlistCandidates,
  getAnalysisSource,
  getDecisionStatus,
  removeShortlistCandidate,
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
