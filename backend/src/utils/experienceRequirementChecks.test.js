import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCanonicalExperienceFactsToCandidate,
  buildExperienceRequirementChecks,
  extractDurationRequirements,
} from './experienceRequirementChecks.js'

function buildHighConfidenceCandidate(overrides = {}) {
  return {
    name: 'Daniel Example',
    years_experience: 4.5,
    score: 60.5,
    matchScore: { score: 60.5, score_out_of_ten: 6.1, reason: 'Existing score reasoning remains.' },
    fit_assessment: {
      overall_fit_score: 60.5,
      matched_requirements: [],
      missing_requirements: [],
      risks_or_gaps: [],
      rationale: 'Existing rationale remains.',
      notes: [],
    },
    experience_entries: [
      {
        title: 'Sales Development Representative',
        company: 'Example Co',
        start_date: '2022-01',
        end_date: '2025-01',
        duration: null,
        description: 'Generated qualified opportunities.',
      },
      {
        title: 'Account Executive',
        company: 'Example Co',
        start_date: '2025-01',
        end_date: '2026-07',
        duration: null,
        description: 'Owned a quota-carrying book of business.',
      },
    ],
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'high',
      total_months: 54,
      total_years: 4.5,
      entry_facts: [
        { entry_index: 0, start_date: '2022-01', end_date: '2025-01', duration_months: 36 },
        { entry_index: 1, start_date: '2025-01', end_date: '2026-07', duration_months: 18 },
      ],
    },
    ...overrides,
  }
}

const QUOTA_AE_CONTEXT = {
  hasContext: true,
  requirementSemantics: {
    required: ['At least 2 years in a closing or quota-carrying Account Executive role.'],
  },
}

test('extracts explicit year and month requirements without treating maximum-only clauses as minimums', () => {
  const requirements = extractDurationRequirements({
    required: [
      'Minimum 2 years of quota-carrying AE experience.',
      'At least 18 months of experience in B2B SaaS sales.',
      'Maximum 5 years of total experience.',
      'Managed a $1M annual quota at 110% attainment.',
    ],
  })

  assert.equal(requirements.length, 2)
  assert.equal(requirements[0].required_months, 24)
  assert.deepEqual(requirements[0].subject_tokens, ['quota', 'account', 'executive'])
  assert.equal(requirements[1].required_months, 18)
  assert.deepEqual(requirements[1].subject_tokens, ['b2b', 'saas', 'sales'])
})

test('classifies Daniel-style quota AE tenure from matching dated entries, not total experience', () => {
  const contract = buildExperienceRequirementChecks(buildHighConfidenceCandidate(), QUOTA_AE_CONTEXT)

  assert.equal(contract.status, 'computed')
  assert.equal(contract.checks[0].required_months, 24)
  assert.deepEqual(contract.checks[0].subject_token_groups, [
    ['close', 'account', 'executive'],
    ['quota', 'account', 'executive'],
  ])
  assert.equal(contract.checks[0].evidenced_months, 18)
  assert.equal(contract.checks[0].status, 'not_met')
  assert.deepEqual(contract.checks[0].evidence_entry_indexes, [1])
})

test('reconciles a false matched requirement while preserving score fields and unrelated narrative', () => {
  const candidate = buildHighConfidenceCandidate({
    summary: 'Daniel has 4.5 years of total professional experience.',
    strengths: ['Strong discovery skills'],
    considerations: ['Review enterprise deal size'],
    matchedRequirementsFull: [
      '18 months of quota-carrying Account Executive experience exceeds the required two years.',
      'Strong discovery methodology',
    ],
    missingRequirementsFull: ['Enterprise deal size is unclear'],
    matchScore: {
      score: 60.5,
      score_out_of_ten: 6.1,
      reason: 'The candidate’s 18 months of quota-carrying AE experience exceeds the two-year minimum. Discovery skills are strong.',
    },
    fit_assessment: {
      overall_fit_score: 60.5,
      matched_requirements: [
        '18 months of quota-carrying Account Executive experience exceeds the required two years.',
        'Strong discovery methodology',
      ],
      missing_requirements: ['Enterprise deal size is unclear'],
      risks_or_gaps: [],
      rationale: 'Quota-carrying Account Executive tenure meets the two-year requirement; enterprise deal size remains unclear.',
      notes: [],
    },
  })
  const snapshot = structuredClone(candidate)

  const result = applyCanonicalExperienceFactsToCandidate(candidate, QUOTA_AE_CONTEXT)

  assert.deepEqual(candidate, snapshot)
  assert.equal(result.applied, true)
  assert.equal(result.candidate.score, 60.5)
  assert.equal(result.candidate.matchScore.score, 60.5)
  assert.equal(result.candidate.matchScore.score_out_of_ten, 6.1)
  assert.equal(result.candidate.fit_assessment.overall_fit_score, 60.5)
  assert.deepEqual(result.candidate.fit_assessment.matched_requirements, ['Strong discovery methodology'])
  assert.equal(result.candidate.fit_assessment.missing_requirements.includes('Enterprise deal size is unclear'), true)
  assert.equal(result.candidate.fit_assessment.missing_requirements.some((entry) => /18 months.*24 months/i.test(entry)), true)
  assert.deepEqual(result.candidate.matchedRequirementsFull, ['Strong discovery methodology'])
  assert.equal(result.candidate.missingRequirementsFull.includes('Enterprise deal size is unclear'), true)
  assert.equal(result.candidate.missingRequirementsFull.some((entry) => /18 months.*24 months/i.test(entry)), true)
  assert.equal(result.candidate.summary, 'Daniel has 4.5 years of total professional experience.')
  assert.match(result.candidate.matchScore.reason, /18 months.*24 months/i)
  assert.match(result.candidate.matchScore.reason, /Discovery skills are strong/i)
  assert.match(result.candidate.fit_assessment.rationale, /18 months.*24 months/i)
  assert.match(result.candidate.fit_assessment.rationale, /enterprise deal size remains unclear/i)
})

test('uses canonical total years consistently without rewriting skill-specific tenure', () => {
  const candidate = buildHighConfidenceCandidate({
    years_experience: 4,
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'high',
      total_months: 36,
      total_years: 3,
      entry_facts: [{ entry_index: 0, start_date: '2022-01', end_date: '2025-01', duration_months: 36 }],
    },
    experience_entries: [{
      title: 'Sales Development Representative',
      start_date: '2022-01',
      end_date: '2025-01',
      description: 'Three years in the role.',
    }],
    considerations: [
      'The candidate has 4 years of experience and meets the overall minimum.',
      'Only 4 years of Kubernetes experience is documented.',
    ],
  })

  const result = applyCanonicalExperienceFactsToCandidate(candidate, {
    hasContext: true,
    requirementSemantics: { required: [] },
  })

  assert.equal(result.candidate.years_experience, 3)
  assert.equal(result.candidate.considerations[0], 'The candidate has 3 years of experience and meets the overall minimum.')
  assert.equal(result.candidate.considerations[1], 'Only 4 years of Kubernetes experience is documented.')
  assert.equal(result.candidate.score, 60.5)
})

test('marks subject-specific tenure unknown when the structured entries do not evidence the subject', () => {
  const contract = buildExperienceRequirementChecks(buildHighConfidenceCandidate(), {
    hasContext: true,
    requirementSemantics: { required: ['Minimum 2 years of product management experience.'] },
  })

  assert.equal(contract.checks[0].status, 'unknown')
  assert.equal(contract.checks[0].evidenced_months, null)
  assert.equal(contract.checks[0].reason_code, 'insufficient_subject_evidence')
})

test('skips application when canonical facts are not high confidence', () => {
  const candidate = buildHighConfidenceCandidate({
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'medium',
      total_months: 54,
      total_years: 4.5,
      entry_facts: [],
    },
  })

  const result = applyCanonicalExperienceFactsToCandidate(candidate, QUOTA_AE_CONTEXT)

  assert.equal(result.applied, false)
  assert.equal(result.skip_reason, 'canonical_facts_not_high_confidence')
  assert.strictEqual(result.candidate, candidate)
})

test('classifies an exact duration boundary as met', () => {
  const candidate = buildHighConfidenceCandidate({
    experience_entries: [{
      title: 'Account Executive',
      start_date: '2024-01',
      end_date: '2026-01',
      description: 'Owned quota.',
    }],
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'high',
      total_months: 24,
      total_years: 2,
      entry_facts: [{ entry_index: 0, start_date: '2024-01', end_date: '2026-01', duration_months: 24 }],
    },
  })

  const contract = buildExperienceRequirementChecks(candidate, QUOTA_AE_CONTEXT)

  assert.equal(contract.checks[0].evidenced_months, 24)
  assert.equal(contract.checks[0].status, 'met')
})
