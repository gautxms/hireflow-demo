import test from 'node:test'
import assert from 'node:assert/strict'

import { applyCandidateFilters, normalizeCandidate, sortCandidates } from './results.js'
import { RESULTS_CONTRACT_FIXTURES } from './__fixtures__/resultsContractFixtures.js'

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


test('sortCandidates most experienced uses normalized years with stable tie-breakers and unknown last', () => {
  const candidates = [
    normalizeCandidate({ name: 'A', score: 80, summary: '3+ years of experience' }),
    normalizeCandidate({ name: 'B', score: 70, summary: '8 years of experience' }),
    normalizeCandidate({ name: 'C', score: 95, summary: '9 months of hands-on experience' }),
    normalizeCandidate({ name: 'D', score: 60, summary: '5.2 years experience' }),
    normalizeCandidate({ name: 'E', score: 99, summary: 'experienced business analyst' }),
  ]
  const sorted = sortCandidates(candidates, 'experience', 'desc')
  assert.deepEqual(sorted.map((candidate) => candidate.name), ['B', 'D', 'A', 'C', 'E'])
})

test('sortCandidates experience tie-breakers use score then name', () => {
  const candidates = [
    normalizeCandidate({ name: 'Zed', score: 82, totalExperienceYears: 5 }),
    normalizeCandidate({ name: 'Amy', score: 82, totalExperienceYears: 5 }),
    normalizeCandidate({ name: 'Bob', score: 90, totalExperienceYears: 5 }),
  ]
  const sorted = sortCandidates(candidates, 'experience', 'desc')
  assert.deepEqual(sorted.map((candidate) => candidate.name), ['Bob', 'Amy', 'Zed'])
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

test('normalizeCandidate remains backward compatible for legacy shape and exposes additive v3 fields', () => {
  const normalized = normalizeCandidate(RESULTS_CONTRACT_FIXTURES.legacyCandidate)
  assert.deepEqual(normalized.matchedRequirements, [])
  assert.deepEqual(normalized.missingRequirements, [])
  assert.deepEqual(normalized.evidence, [])
  assert.equal(typeof normalized.suggestedRecruiterAction, 'string')
  assert.equal(normalized.resumeFilename, '')
  assert.equal(normalized.resumeAssetRef, '')
})

test('normalizeCandidate keeps strict v3 contract fields when provided', () => {
  const normalized = normalizeCandidate(RESULTS_CONTRACT_FIXTURES.candidateV3OptIn)
  assert.deepEqual(normalized.matchedRequirements, ['Node.js API development', 'PostgreSQL query optimization'])
  assert.deepEqual(normalized.missingRequirements, ['SOC2 operations ownership'])
  assert.equal(normalized.evidence[0].section, 'Experience')
  assert.equal(normalized.evidence[0].span, 'Acme Corp, 2022-2025')
  assert.equal(normalized.parseMeta.contractVersion, 'candidate-v3')
  assert.equal(normalized.parseMeta.contractMode, 'opt_in')
})


test('normalizeCandidate preserves legacy aliases while passing through canonical alias fields when present', () => {
  const payload = {
    skills: ['React'],
    allExtractedSkills: ['React', 'Node'],
    skills_flat: ['React', 'Node'],
    skills_structured: { tools_and_platforms: ['React'], methodologies: ['Agile'], domain_expertise: [], soft_skills: [] },
    education: [{ degree: 'BS', institution: 'State U' }],
    totalExperienceYears: 7,
    relevantExperienceYears: 5,
    experienceLabel: '7 years total',
    experienceSource: 'resume',
    isExperienceEstimated: false,
    experienceExplanation: 'Parsed from structured resume sections.',
  }

  const normalized = normalizeCandidate(payload)

  assert.deepEqual(normalized.allExtractedSkills, ['React', 'Node'])
  assert.deepEqual(normalized.skills_flat, ['React', 'Node'])
  assert.deepEqual(normalized.skills_structured, payload.skills_structured)
  assert.deepEqual(normalized.education, payload.education)
  assert.equal(normalized.totalExperienceYears, 7)
  assert.equal(normalized.relevantExperienceYears, 5)
  assert.equal(normalized.experienceLabel, '7 years total')
  assert.equal(normalized.experienceSource, 'resume')
  assert.equal(normalized.isExperienceEstimated, false)
  assert.equal(normalized.experienceExplanation, 'Parsed from structured resume sections.')

  assert.ok('skills' in normalized)
  assert.ok('legacyEducation' in normalized)
  assert.ok('experience_years' in normalized)
})

test('normalizeCandidate keeps canonical defaults for legacy payloads without new alias fields', () => {
  const normalized = normalizeCandidate({
    skills: 'React, Node',
    experience: '4 years',
    highestEducation: 'BSc Computer Science',
  })

  assert.ok(!('allExtractedSkills' in normalized))
  assert.ok(!('isExperienceEstimated' in normalized))
  assert.ok(!('experienceExplanation' in normalized))
  assert.deepEqual(normalized.skills_flat, ['React', 'Node'])
  assert.equal(Array.isArray(normalized.education), true)
  assert.equal(normalized.totalExperienceYears, 4)
})
