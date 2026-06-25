import test from 'node:test'
import assert from 'node:assert/strict'

import { applyCandidateFilters, normalizeCandidate, selectShareCandidatesForUser, shareTokenStore, sortCandidates } from './results.js'
import { RESULTS_CONTRACT_FIXTURES } from './__fixtures__/resultsContractFixtures.js'

const ownedShareCandidates = [
  { id: 'cand-1', resumeId: 'resume-1', name: 'Owned One', email: 'owned1@example.com', phone: '111', score: 92, skills: ['React'], location: 'Austin', experience: '6 years' },
  { id: 'cand-2', resumeId: 'resume-2', name: 'Owned Two', email: 'owned2@example.com', phone: '222', score: 81, skills: ['Python'], location: 'Denver', experience: '3 years' },
]

function loadOwnedCandidates() {
  return Promise.resolve(ownedShareCandidates)
}

function pickScoreContractFields(candidate) {
  return {
    score: candidate.score,
    matchScore: candidate.matchScore,
    profile_score: candidate.profile_score,
    years_experience: candidate.years_experience,
    seniority_level: candidate.seniority_level,
    top_skills: candidate.top_skills,
    summary: candidate.summary,
    strengths: candidate.strengths,
    considerations: candidate.considerations,
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

test('normalizeCandidate falls back to top-level score when matchScore.score is absent', () => {
  const normalized = normalizeCandidate({
    score: 73,
    matchScore: { reason: 'Missing nested score' },
  })

  assert.equal(normalized.score, 73)
  assert.equal(normalized.matchScore.score, 73)
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
      matchScore: {
        score: 88,
        reason: 'Strong fit for role requirements',
      },
      profile_score: 88,
      years_experience: 6,
      seniority_level: 'senior',
      top_skills: ['React', 'Node.js', 'TypeScript'],
      summary: 'Summary not provided in this analysis.',
      strengths: ['Candidate scored using role fit, skills alignment, and experience depth.'],
      considerations: ['Validate role-specific depth during interview.'],
    },
  )
})

test('existing result candidate scores remain unchanged when diagnostics are available', () => {
  const normalized = normalizeCandidate({
    score: 72,
    matchScore: { score: 82, score_out_of_ten: 7.2 },
    profile_score: 91,
  })

  assert.equal(normalized.score, 82)
  assert.equal(normalized.matchScore.score, 82)
  assert.equal(normalized.profile_score, 91)
})

test('selectShareCandidatesForUser shares latest server candidates when request omits candidates', async () => {
  const selected = await selectShareCandidatesForUser({
    userId: 'user-1',
    loadCandidates: loadOwnedCandidates,
  })

  assert.deepEqual(selected.map((candidate) => candidate.id), ['cand-1', 'cand-2'])
  assert.equal(selected[0].email, 'owned1@example.com')
})


test('selectShareCandidatesForUser loads candidates for the requested analysis before intersecting identifiers', async () => {
  const loadCalls = []
  const selected = await selectShareCandidatesForUser({
    userId: 'user-1',
    analysisId: 'analysis-123',
    requestedCandidates: [
      { id: 'cand-1', resumeId: 'resume-1' },
      { id: 'cand-2', resumeId: 'resume-2' },
    ],
    loadCandidates: (userId, options) => {
      loadCalls.push({ userId, options })
      return Promise.resolve(ownedShareCandidates)
    },
  })

  assert.deepEqual(loadCalls, [{ userId: 'user-1', options: { analysisId: 'analysis-123' } }])
  assert.deepEqual(selected.map((candidate) => candidate.id), ['cand-1', 'cand-2'])
})

test('selectShareCandidatesForUser rejects arbitrary client-supplied candidate objects without owned identifiers', async () => {
  const selected = await selectShareCandidatesForUser({
    userId: 'user-1',
    requestedCandidates: [{ id: 'attacker-candidate', name: 'Injected', email: 'pii@example.com', score: 100 }],
    loadCandidates: loadOwnedCandidates,
  })

  assert.deepEqual(selected, [])
})

test('selectShareCandidatesForUser uses client candidates only as owned identifier selectors', async () => {
  const selected = await selectShareCandidatesForUser({
    userId: 'user-1',
    requestedCandidates: [{ id: 'cand-1', name: 'Injected Name', email: 'attacker@example.com', phone: '999', score: 1 }],
    loadCandidates: loadOwnedCandidates,
  })

  assert.equal(selected.length, 1)
  assert.equal(selected[0].id, 'cand-1')
  assert.equal(selected[0].name, 'Owned One')
  assert.equal(selected[0].email, 'owned1@example.com')
  assert.equal(selected[0].phone, '111')
  assert.equal(selected[0].score, 92)
})

test('selectShareCandidatesForUser stores only owned candidates from mixed owned and unowned requests', async () => {
  const selected = await selectShareCandidatesForUser({
    userId: 'user-1',
    requestedCandidates: [
      { candidateId: 'cand-2', email: 'tampered@example.com' },
      { id: 'unowned-candidate', email: 'unowned@example.com' },
    ],
    loadCandidates: loadOwnedCandidates,
  })

  assert.deepEqual(selected.map((candidate) => candidate.id), ['cand-2'])
  assert.equal(selected[0].email, 'owned2@example.com')
})

test('selectShareCandidatesForUser preserves share filtering, sorting, and caps public payloads', async () => {
  const manyCandidates = Array.from({ length: 125 }, (_, index) => ({
    id: `cand-${index}`,
    name: `Candidate ${String(index).padStart(3, '0')}`,
    score: index,
    skills: ['React'],
    experience: '5 years',
  }))

  const selected = await selectShareCandidatesForUser({
    userId: 'user-1',
    query: { skills: 'React' },
    filters: { matchMin: '10' },
    sortBy: 'score',
    sortOrder: 'desc',
    loadCandidates: () => Promise.resolve(manyCandidates),
  })

  assert.equal(selected.length, 100)
  assert.equal(selected[0].id, 'cand-124')
  assert.equal(selected.at(-1).id, 'cand-25')
})

test('public shared payload remains read-only and exposes stored server-derived candidates', () => {
  const token = 'unit-test-share-token'
  const expiresAt = Date.now() + 60_000
  const serverCandidate = normalizeCandidate(ownedShareCandidates[0])
  shareTokenStore.set(token, {
    candidates: [serverCandidate],
    createdAt: Date.now(),
    expiresAt,
    ownerUserId: 'user-1',
    query: { search: 'Owned' },
  })

  const payload = shareTokenStore.get(token)
  const publicResponse = {
    candidates: payload.candidates,
    readOnly: true,
    expiresAt: payload.expiresAt,
    query: payload.query || {},
  }

  assert.equal(publicResponse.readOnly, true)
  assert.equal(publicResponse.expiresAt, expiresAt)
  assert.deepEqual(publicResponse.query, { search: 'Owned' })
  assert.equal(publicResponse.candidates[0].email, 'owned1@example.com')

  shareTokenStore.delete(token)
})

test('normalizeCandidate passes through preserved full display fields before compact fields', () => {
  const normalized = normalizeCandidate({
    name: 'Full Field Candidate',
    summary: 'Compact summary',
    summaryFull: 'Full summary from AI normalizer with complete context.',
    recommendation: 'Compact recommendation',
    recommendationFull: 'Full recommendation from AI normalizer with next-step context.',
    strengths: ['Compact strength'],
    strengthsFull: ['Full strength from preserved analysis payload.'],
    considerations: ['Compact consideration'],
    risksOrGapsFull: ['Full risk or gap from preserved analysis payload.'],
    matchedSkills: ['Compact matched skill'],
    missingSkills: ['Compact missing skill'],
    matchedRequirementsFull: ['Full matched requirement from preserved analysis payload.'],
    missingRequirementsFull: ['Full missing requirement from preserved analysis payload.'],
    matchScore: {
      score: 84,
      reason: 'Compact match reason',
      reasonFull: 'Full match reasoning from score details.',
    },
    fit_assessment: {
      reason: 'Compact fit reason',
      rationale: 'Fit rationale fallback',
      matched_requirements: ['Fit matched requirement fallback'],
      missing_requirements: ['Fit missing requirement fallback'],
      risks_or_gaps: ['Fit risk fallback'],
    },
  })

  assert.equal(normalized.summary, 'Compact summary')
  assert.equal(normalized.matchScore.reason, 'Compact match reason')
  assert.equal(normalized.summaryFull, 'Full summary from AI normalizer with complete context.')
  assert.equal(normalized.reasoningFull, 'Full match reasoning from score details.')
  assert.equal(normalized.recommendationFull, 'Full recommendation from AI normalizer with next-step context.')
  assert.deepEqual(normalized.strengthsFull, ['Full strength from preserved analysis payload.'])
  assert.deepEqual(normalized.considerationsFull, ['Full risk or gap from preserved analysis payload.'])
  assert.deepEqual(normalized.risksOrGapsFull, ['Full risk or gap from preserved analysis payload.'])
  assert.deepEqual(normalized.matchedRequirementsFull, ['Full matched requirement from preserved analysis payload.'])
  assert.deepEqual(normalized.missingRequirementsFull, ['Full missing requirement from preserved analysis payload.'])
  assert.deepEqual(normalized.rawDisplayFields, {
    summary: 'Full summary from AI normalizer with complete context.',
    reasoning: 'Full match reasoning from score details.',
    recommendation: 'Full recommendation from AI normalizer with next-step context.',
    strengths: ['Full strength from preserved analysis payload.'],
    considerations: ['Full risk or gap from preserved analysis payload.'],
    matchedRequirements: ['Full matched requirement from preserved analysis payload.'],
    missingRequirements: ['Full missing requirement from preserved analysis payload.'],
    risksOrGaps: ['Full risk or gap from preserved analysis payload.'],
  })
})

test('normalizeCandidate preserves displayText and rawDisplayFields full values with safe fallback order', () => {
  const normalized = normalizeCandidate({
    summary: 'Compact summary',
    recommendation: 'Compact recommendation',
    displayText: {
      summary: { full: 'DisplayText summary wins.' },
      recommendation: { full: 'DisplayText recommendation wins.' },
      matchedRequirements: { full: ['DisplayText matched requirement wins.'] },
      missingRequirements: { full: ['DisplayText missing requirement wins.'] },
      risksOrGaps: { full: ['DisplayText risk wins.'] },
      strengths: { full: ['DisplayText strength wins.'] },
    },
    rawDisplayFields: {
      summary: 'Raw summary fallback',
      reasoning: 'Raw reasoning fallback wins over compact reason.',
      recommendation: 'Raw recommendation fallback',
      matchedRequirements: ['Raw matched fallback'],
      missingRequirements: ['Raw missing fallback'],
      risksOrGaps: ['Raw risk fallback'],
      strengths: ['Raw strength fallback'],
    },
    matchScore: { score: 77, reason: 'Compact reason' },
    fit_assessment: {
      reason: 'Fit reason',
      matched_requirements: ['Fit matched fallback'],
      missing_requirements: ['Fit missing fallback'],
      risks_or_gaps: ['Fit risk fallback'],
    },
  })

  assert.equal(normalized.summaryFull, 'DisplayText summary wins.')
  assert.equal(normalized.reasoningFull, 'Raw reasoning fallback wins over compact reason.')
  assert.equal(normalized.recommendationFull, 'DisplayText recommendation wins.')
  assert.deepEqual(normalized.strengthsFull, ['DisplayText strength wins.'])
  assert.deepEqual(normalized.matchedRequirementsFull, ['DisplayText matched requirement wins.'])
  assert.deepEqual(normalized.missingRequirementsFull, ['DisplayText missing requirement wins.'])
  assert.deepEqual(normalized.risksOrGapsFull, ['DisplayText risk wins.'])
})
