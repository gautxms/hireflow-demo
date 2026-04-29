import test from 'node:test'
import assert from 'node:assert/strict'

import { applyCandidateFilters, normalizeCandidate, sortCandidates } from './results.js'
import { RESULTS_CONTRACT_FIXTURES } from './__fixtures__/resultsContractFixtures.js'

function pickScoreContractFields(candidate) {
  return {
    score: candidate.score,
    profile_score: candidate.profile_score,
    years_experience: candidate.years_experience,
    seniority_level: candidate.seniority_level,
    top_skills: candidate.top_skills,
  }
}

test('applyCandidateFilters supports search, skills, and numeric ranges', () => {
  const candidates = [
    normalizeCandidate({ name: 'Alice Doe', email: 'alice@example.com', skills: ['React', 'Node'], experience: '6 years', score: 88 }),
    normalizeCandidate({ name: 'Bob Roe', email: 'bob@example.com', skills: ['Python'], experience: '2 years', score: 71 }),
  ]

  const filtered = applyCandidateFilters(candidates, {
    search: 'alice',
    skills: 'react,node',
    experienceMin: '5',
    matchMin: '80',
  })

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].name, 'Alice Doe')
})

test('sortCandidates supports upload date and name modes', () => {
  const candidates = [
    normalizeCandidate({ name: 'Zoe', score: 60, uploadDate: '2024-01-01T00:00:00Z' }),
    normalizeCandidate({ name: 'Amy', score: 99, uploadDate: '2025-01-01T00:00:00Z' }),
  ]

  const nameSorted = sortCandidates(candidates, 'name', 'desc')
  assert.deepEqual(nameSorted.map((candidate) => candidate.name), ['Amy', 'Zoe'])

  const uploadSorted = sortCandidates(candidates, 'upload_date', 'desc')
  assert.deepEqual(uploadSorted.map((candidate) => candidate.name), ['Amy', 'Zoe'])
})

test('sortCandidates treats match_score as score and keeps name ascending', () => {
  const candidates = [
    normalizeCandidate({ name: 'Mia', score: 81 }),
    normalizeCandidate({ name: 'Ava', score: 91 }),
    normalizeCandidate({ name: 'Lia', score: 75 }),
  ]

  const matchSorted = sortCandidates(candidates, 'match_score', 'desc')
  assert.deepEqual(matchSorted.map((candidate) => candidate.name), ['Ava', 'Mia', 'Lia'])

  const forcedNameAsc = sortCandidates(candidates, 'name', 'desc')
  assert.deepEqual(forcedNameAsc.map((candidate) => candidate.name), ['Ava', 'Lia', 'Mia'])
})

test('normalizeCandidate returns canonical adapter fields for candidate and resume ids', () => {
  const resumeId = '550e8400-e29b-41d4-a716-446655440000'
  const normalized = normalizeCandidate({ id: 'parsed-2', resume_id: resumeId })

  assert.equal(normalized.id, 'parsed-2')
  assert.equal(normalized.candidateId, 'parsed-2')
  assert.equal(normalized.resumeId, resumeId)
})

test('fixture: candidate normalization keeps legacy and modern payload score contracts in sync (no-diff gate)', () => {
  const normalizedLegacy = normalizeCandidate(RESULTS_CONTRACT_FIXTURES.legacyCandidate)
  const normalizedModern = normalizeCandidate(RESULTS_CONTRACT_FIXTURES.modernCandidate)

  assert.deepEqual(
    pickScoreContractFields(normalizedLegacy),
    pickScoreContractFields(normalizedModern),
  )

  assert.deepEqual(
    normalizedLegacy.skills_flat,
    normalizedModern.skills_flat,
  )
})

test('fixture: results response contract retains filters/sort/pagination envelope and score fields', () => {
  const candidate = normalizeCandidate(RESULTS_CONTRACT_FIXTURES.modernCandidate)

  const response = {
    candidates: [candidate],
    pagination: {
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
    },
    sort: { sortBy: 'score', sortOrder: 'desc' },
    filters: {
      scoreMin: null,
      scoreMax: null,
      location: null,
      level: null,
      search: null,
      skills: null,
      experienceMin: null,
      experienceMax: null,
      matchMin: null,
      matchMax: null,
    },
  }

  assert.deepEqual(Object.keys(response), ['candidates', 'pagination', 'sort', 'filters'])
  assert.deepEqual(Object.keys(response.pagination), ['page', 'pageSize', 'total', 'totalPages', 'hasNextPage'])
  assert.deepEqual(Object.keys(response.sort), ['sortBy', 'sortOrder'])
  assert.equal(typeof response.filters.matchMin, 'object')

  assert.deepEqual(
    pickScoreContractFields(response.candidates[0]),
    {
      score: 88,
      profile_score: 88,
      years_experience: 6,
      seniority_level: 'senior',
      top_skills: ['React', 'Node.js', 'TypeScript'],
    },
  )
})
