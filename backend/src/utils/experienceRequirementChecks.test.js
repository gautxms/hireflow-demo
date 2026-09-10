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

const COMPOUND_SALES_CONTEXT = {
  hasContext: true,
  requirementSemantics: {
    required: ['4-7 years of professional sales experience, including at least 2 years in a closing or quota-carrying AE role.'],
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

test('extracts every duration from the production compound sales requirement', () => {
  const requirements = extractDurationRequirements(COMPOUND_SALES_CONTEXT.requirementSemantics)

  assert.equal(requirements.length, 2)
  assert.equal(requirements[0].required_months, 48)
  assert.equal(requirements[0].subject, 'professional sales')
  assert.deepEqual(requirements[0].subject_token_groups, [['sales']])
  assert.equal(requirements[1].required_months, 24)
  assert.equal(requirements[1].subject, 'closing or quota-carrying AE')
  assert.deepEqual(requirements[1].subject_token_groups, [
    ['close', 'account', 'executive'],
    ['quota', 'account', 'executive'],
  ])
})

test('classifies both total sales and Daniel-style AE tenure from one compound requirement', () => {
  const candidate = buildHighConfidenceCandidate({
    years_experience: 4,
    experience_entries: [
      {
        title: 'Account Executive',
        start_date: '2025-03',
        end_date: null,
        description: 'Carries an annual quota and runs discovery, demos, negotiation, and close.',
      },
      {
        title: 'Business Development Executive',
        start_date: '2022-01',
        end_date: '2025-02',
        description: 'Prospected local businesses and supported proposals.',
      },
    ],
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'high',
      total_months: 55,
      total_years: 4.6,
      entry_facts: [
        { entry_index: 0, start_date: '2025-03', end_date: '2026-09', duration_months: 18 },
        { entry_index: 1, start_date: '2022-01', end_date: '2025-02', duration_months: 37 },
      ],
    },
  })

  const contract = buildExperienceRequirementChecks(candidate, COMPOUND_SALES_CONTEXT)

  assert.equal(contract.status, 'computed')
  assert.equal(contract.checks.length, 2)
  assert.equal(contract.checks[0].evidenced_months, 55)
  assert.equal(contract.checks[0].status, 'met')
  assert.deepEqual(contract.checks[0].evidence_entry_indexes, [0, 1])
  assert.equal(contract.checks[1].evidenced_months, 18)
  assert.equal(contract.checks[1].status, 'not_met')
  assert.deepEqual(contract.checks[1].evidence_entry_indexes, [0])
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

test('corrects the production Daniel contradiction across visible analysis fields without changing scores', () => {
  const candidate = buildHighConfidenceCandidate({
    years_experience: 4,
    experience_entries: [
      {
        title: 'Account Executive',
        start_date: '2025-03',
        end_date: null,
        description: 'Carries an annual quota and runs discovery, demos, negotiation, and close.',
      },
      {
        title: 'Business Development Executive',
        start_date: '2022-01',
        end_date: '2025-02',
        description: 'Prospected local businesses and supported proposals.',
      },
    ],
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'high',
      total_months: 55,
      total_years: 4.6,
      entry_facts: [
        { entry_index: 0, start_date: '2025-03', end_date: '2026-09', duration_months: 18 },
        { entry_index: 1, start_date: '2022-01', end_date: '2025-02', duration_months: 37 },
      ],
    },
    matchedSkills: [
      '18 months of closing/quota-carrying AE experience exceeds the 2-year minimum.',
      'HubSpot pipeline management',
    ],
    missingSkills: ['Formal sales methodology'],
    matchedRequirementsFull: [
      '4.5 years of professional sales experience meets the 4-7 year range.',
      '18 months of closing/quota-carrying AE experience exceeds the 2-year minimum.',
      'Experience selling B2B software and SaaS into US-based companies',
    ],
    missingRequirementsFull: ['Formal sales methodology'],
    matchScore: {
      score: 60.5,
      score_out_of_ten: 6.1,
      reason: 'Daniel has 18 months of quota-carrying AE tenure, meeting core experience requirements. HubSpot proficiency is strong.',
      breakdown: {
        experience_match: '70% — 4.5 years total meets the range; 18 months quota-carrying AE meets the 2-year minimum.',
        skills_match: 'HubSpot proficiency is strong.',
      },
    },
    fit_assessment: {
      overall_fit_score: 60.5,
      matched_requirements: [
        '18 months of closing/quota-carrying AE experience exceeds the 2-year minimum.',
        'Experience selling B2B software and SaaS into US-based companies',
      ],
      missing_requirements: ['Formal sales methodology'],
      risks_or_gaps: [],
      rationale: 'Daniel meets core experience thresholds with 18 months quota-carrying AE experience. HubSpot proficiency is strong.',
      notes: [],
    },
    recommendation: 'Daniel has 18 months of quota-carrying AE tenure and meets the minimum.',
    recommendationFull: 'Daniel has 18 months of quota-carrying AE tenure and meets the minimum. HubSpot proficiency is strong.',
  })
  const snapshot = structuredClone(candidate)

  const result = applyCanonicalExperienceFactsToCandidate(candidate, COMPOUND_SALES_CONTEXT)
  const visibleNarrative = JSON.stringify({
    matchedSkills: result.candidate.matchedSkills,
    missingSkills: result.candidate.missingSkills,
    matchedRequirementsFull: result.candidate.matchedRequirementsFull,
    missingRequirementsFull: result.candidate.missingRequirementsFull,
    matchScore: result.candidate.matchScore,
    fit_assessment: result.candidate.fit_assessment,
    recommendation: result.candidate.recommendation,
    recommendationFull: result.candidate.recommendationFull,
  })

  assert.deepEqual(candidate, snapshot)
  assert.equal(result.candidate.years_experience, 4.6)
  assert.equal(result.candidate.experience_requirement_checks_v1.checks.length, 2)
  assert.equal(result.candidate.experience_requirement_checks_v1.checks[0].status, 'met')
  assert.equal(result.candidate.experience_requirement_checks_v1.checks[1].status, 'not_met')
  assert.equal(result.candidate.experience_facts_apply_metadata.duration_requirement_met_count, 1)
  assert.equal(result.candidate.experience_facts_apply_metadata.duration_requirement_not_met_count, 1)
  assert.equal(result.candidate.experience_facts_apply_metadata.duration_requirement_unknown_count, 0)
  assert.doesNotMatch(visibleNarrative, /18 months[^.]{0,100}(?:exceeds|meeting core experience|meets the (?:2-year|24-month))/i)
  assert.match(visibleNarrative, /18 months[^.]{0,100}does not meet[^.]{0,100}24 months/i)
  assert.match(visibleNarrative, /Experience selling B2B software and SaaS/i)
  assert.match(visibleNarrative, /HubSpot proficiency is strong/i)
  assert.equal(result.candidate.score, 60.5)
  assert.equal(result.candidate.matchScore.score, 60.5)
  assert.equal(result.candidate.matchScore.score_out_of_ten, 6.1)
  assert.equal(result.candidate.fit_assessment.overall_fit_score, 60.5)
})

test('corrects stale Liam and Noah sales-year claims while retaining the AE gap and score fields', async (t) => {
  const cases = [
    {
      name: 'Liam Example',
      originalYears: 2,
      canonicalYears: 4.2,
      totalMonths: 50,
      expectedTotalStatus: 'met',
      stalePattern: /(?<![\d.])(?:has|his)\s+2\s+years|(?<![\d.])2\s+years\s+(?:of\s+)?retail/i,
      entries: [
        { title: 'Sales Supervisor', start_date: '2024-04', end_date: null, description: 'Led a retail team.' },
        { title: 'Sales Associate', start_date: '2022-06', end_date: '2024-03', description: 'Assisted retail customers.' },
      ],
      entryFacts: [
        { entry_index: 0, start_date: '2024-04', end_date: '2026-09', duration_months: 29 },
        { entry_index: 1, start_date: '2022-06', end_date: '2024-03', duration_months: 21 },
      ],
      reason: 'Liam has 2 years of retail sales experience, not the required 4-7 years of professional sales experience.',
      breakdown: '15/100 - Has 2 years retail; requires 4-7 years professional sales.',
      risk: 'His 2 years of retail sales experience does not satisfy the 4-7 year requirement.',
      aeGap: '2+ years in closing or quota-carrying AE role (no evidence of quota-carrying sales)',
    },
    {
      name: 'Noah Example',
      originalYears: 1,
      canonicalYears: 3.2,
      totalMonths: 38,
      expectedTotalStatus: 'not_met',
      stalePattern: /(?:has|with)\s+~?1\s+year|1\s+year\s+(?:total|consumer|combined|vs)/i,
      entries: [
        { title: 'Sales Associate', start_date: '2024-08', end_date: null, description: 'Sold consumer mobile plans.' },
        { title: 'Customer Service & Sales Representative', start_date: '2023-06', end_date: '2024-07', description: 'Recommended add-on services.' },
      ],
      entryFacts: [
        { entry_index: 0, start_date: '2024-08', end_date: '2026-09', duration_months: 25 },
        { entry_index: 1, start_date: '2023-06', end_date: '2024-07', duration_months: 13 },
      ],
      reason: 'Noah has 1 year of consumer retail and inbound service sales experience, well below the required 4-7 years.',
      breakdown: '12/100 (1 year vs. 4-7 required)',
      risk: 'Significant experience gap: 1 year vs. 4–7 years required; candidate is early-career and lacks enterprise sales maturity.',
      aeGap: 'At least 2 years in a quota-carrying Account Executive role; candidate has none.',
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const candidate = buildHighConfidenceCandidate({
        name: scenario.name,
        years_experience: scenario.originalYears,
        score: 32.4,
        experience_entries: scenario.entries,
        experience_facts_v1: {
          version: 'experience_facts_v1',
          status: 'computed',
          confidence: 'high',
          total_months: scenario.totalMonths,
          total_years: scenario.canonicalYears,
          entry_facts: scenario.entryFacts,
        },
        concerns: [scenario.risk],
        risksOrGapsFull: [scenario.risk],
        matchedSkills: [],
        missingSkills: [
          `${scenario.originalYears} years of professional sales experience does not meet the 4-7 year requirement.`,
          scenario.aeGap,
        ],
        matchedRequirementsFull: [],
        missingRequirementsFull: [
          `${scenario.originalYears} years of professional sales experience does not meet the 4-7 year requirement.`,
          scenario.aeGap,
        ],
        matchScore: {
          score: 32.4,
          score_out_of_ten: 3.2,
          reason: scenario.reason,
          breakdown: { years_of_experience_fit: scenario.breakdown },
        },
        fit_assessment: {
          overall_fit_score: 32.4,
          matched_requirements: [],
          missing_requirements: [
            `${scenario.originalYears} years of professional sales experience does not meet the 4-7 year requirement.`,
            scenario.aeGap,
          ],
          risks_or_gaps: [scenario.risk],
          rationale: scenario.risk,
          notes: [],
        },
        recommendation: scenario.reason,
        recommendationFull: scenario.reason,
      })

      const result = applyCanonicalExperienceFactsToCandidate(candidate, COMPOUND_SALES_CONTEXT)
      const visibleNarrative = JSON.stringify({
        concerns: result.candidate.concerns,
        risksOrGapsFull: result.candidate.risksOrGapsFull,
        matchedSkills: result.candidate.matchedSkills,
        missingSkills: result.candidate.missingSkills,
        matchedRequirementsFull: result.candidate.matchedRequirementsFull,
        missingRequirementsFull: result.candidate.missingRequirementsFull,
        matchScore: result.candidate.matchScore,
        fit_assessment: result.candidate.fit_assessment,
        recommendation: result.candidate.recommendation,
        recommendationFull: result.candidate.recommendationFull,
      })

      assert.equal(result.candidate.years_experience, scenario.canonicalYears)
      assert.equal(result.candidate.experience_requirement_checks_v1.checks.length, 2)
      assert.equal(result.candidate.experience_requirement_checks_v1.checks[0].evidenced_months, scenario.totalMonths)
      assert.equal(result.candidate.experience_requirement_checks_v1.checks[0].status, scenario.expectedTotalStatus)
      assert.equal(result.candidate.experience_requirement_checks_v1.checks[1].status, 'unknown')
      assert.doesNotMatch(visibleNarrative, scenario.stalePattern)
      assert.match(visibleNarrative, new RegExp(String(scenario.canonicalYears).replace('.', '\\.') + ' years', 'i'))
      assert.match(visibleNarrative, /(?:2\+ years in closing or quota-carrying AE|At least 2 years in a quota-carrying Account Executive role)/i)
      for (const missingRequirements of [
        result.candidate.missingSkills,
        result.candidate.missingRequirementsFull,
        result.candidate.fit_assessment.missing_requirements,
      ]) {
        assert.equal(missingRequirements.includes(scenario.aeGap), true)
      }
      assert.equal(result.candidate.score, 32.4)
      assert.equal(result.candidate.matchScore.score, 32.4)
      assert.equal(result.candidate.matchScore.score_out_of_ten, 3.2)
      assert.equal(result.candidate.fit_assessment.overall_fit_score, 32.4)
    })
  }
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

test('does not classify customer success tenure as sales from an incidental sales-demo reference', () => {
  const candidate = buildHighConfidenceCandidate({
    experience_entries: [{
      title: 'Customer Success Associate',
      start_date: '2020-07',
      end_date: '2022-01',
      description: 'Occasionally joined sales demos as a product specialist but did not own qualification or closing.',
    }],
    experience_facts_v1: {
      version: 'experience_facts_v1',
      status: 'computed',
      confidence: 'high',
      total_months: 18,
      total_years: 1.5,
      entry_facts: [{ entry_index: 0, start_date: '2020-07', end_date: '2022-01', duration_months: 18 }],
    },
  })

  const contract = buildExperienceRequirementChecks(candidate, COMPOUND_SALES_CONTEXT)

  assert.equal(contract.checks[0].subject, 'professional sales')
  assert.equal(contract.checks[0].status, 'unknown')
  assert.equal(contract.checks[0].evidenced_months, null)
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
