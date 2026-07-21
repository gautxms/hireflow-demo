import test from 'node:test'
import assert from 'node:assert/strict'

import {
  V3_SHADOW_SCORING_CONTRACT_VERSION,
  normalizeV3ShadowContract,
  scoreCandidateWithV3Shadow,
} from './v3ShadowScoringService.js'
import { buildRequirementSemantics } from '../utils/requirementSemantics.js'

function jd(overrides = {}) {
  const context = {
    hasContext: true,
    requirements: [
      'Required: Node.js or Java',
      'PostgreSQL is required',
      'Design and deliver production APIs',
      'Preferred: Kubernetes',
    ].join('\n'),
    skills: [],
    experienceMin: 4,
    experienceMax: 7,
    location: 'Bengaluru / Hyderabad / Pune',
    employmentType: 'Remote Hybrid',
    ...overrides,
  }
  context.requirementSemantics = buildRequirementSemantics(context)
  return context
}

function excellentCandidate(overrides = {}) {
  return {
    years_experience: 5.5,
    location: 'Kochi, India',
    skills_flat: ['Node.js', 'PostgreSQL', 'Kubernetes'],
    matchedSkills: ['Node.js', 'PostgreSQL', 'Kubernetes'],
    missingSkills: [],
    experience: [
      'Built and owned production Node.js APIs serving 2 million requests per day.',
      'Designed PostgreSQL systems and reduced query latency by 45%.',
    ],
    projects: ['Deployed a Kubernetes platform used by 20 teams.'],
    achievements: ['Improved release frequency by 3x.'],
    fit_assessment: {
      matched_requirements: ['Node.js', 'PostgreSQL', 'Production APIs'],
      missing_requirements: [],
      risks_or_gaps: [],
    },
    ...overrides,
  }
}

test('V3 shadow is deterministic, bounded, and never mutates input', () => {
  const candidate = excellentCandidate()
  const context = jd()
  const beforeCandidate = structuredClone(candidate)
  const beforeContext = structuredClone(context)
  const first = scoreCandidateWithV3Shadow(candidate, context)

  assert.deepEqual(scoreCandidateWithV3Shadow(candidate, context), first)
  assert.deepEqual(candidate, beforeCandidate)
  assert.deepEqual(context, beforeContext)
  assert.equal(first.scoring_contract_version, V3_SHADOW_SCORING_CONTRACT_VERSION)
  assert.equal(first.scoring_mode, 'shadow_only')
  assert.equal(first.status, 'computed')
  assert.ok(first.final_score >= 98 && first.final_score <= 100)
})

test('preferred gaps have limited impact and never become core failures', () => {
  const withPreferred = scoreCandidateWithV3Shadow(excellentCandidate(), jd())
  const withoutPreferred = scoreCandidateWithV3Shadow(excellentCandidate({
    skills_flat: ['Node.js', 'PostgreSQL'],
    matchedSkills: ['Node.js', 'PostgreSQL'],
    projects: ['Delivered a production API migration.'],
    fit_assessment: {
      matched_requirements: ['Node.js', 'PostgreSQL', 'Production APIs'],
      missing_requirements: [],
      preferred_gaps: ['Kubernetes'],
    },
  }), jd())

  assert.equal(withoutPreferred.components.core_requirements.missing_count, 0)
  assert.equal(withoutPreferred.adjustments.preferred_bonus, 0)
  assert.ok(withPreferred.final_score - withoutPreferred.final_score <= 5)
})

test('alternative technologies satisfy one core group rather than accumulating gaps', () => {
  const result = scoreCandidateWithV3Shadow(excellentCandidate({
    skills_flat: ['Java', 'PostgreSQL'],
    matchedSkills: ['Java', 'PostgreSQL'],
    fit_assessment: {
      matched_requirements: ['Java', 'PostgreSQL', 'Production APIs'],
      missing_requirements: ['Node.js is not documented'],
    },
  }), jd())

  assert.equal(result.components.core_requirements.missing_count, 0)
})

test('education and seniority do not affect the contract unless explicitly required', () => {
  const baseline = scoreCandidateWithV3Shadow(excellentCandidate({ education: [] }), jd())
  const unrelatedEducation = scoreCandidateWithV3Shadow(excellentCandidate({
    education: ['Unrelated diploma'],
    seniority_level: 'Junior',
  }), jd())
  assert.equal(baseline.final_score, unrelatedEducation.final_score)
  assert.equal(baseline.components.core_requirements.education_requirement_explicit, false)
  assert.equal(baseline.components.core_requirements.seniority_requirement_explicit, false)

  const explicitContext = jd({
    requirements: 'Node.js is required\nBachelor degree is required\nTeam leadership is required',
  })
  explicitContext.requirementSemantics = buildRequirementSemantics(explicitContext)
  const missing = scoreCandidateWithV3Shadow(excellentCandidate({
    education: [],
    fit_assessment: {
      matched_requirements: ['Node.js'],
      missing_requirements: ['Bachelor degree', 'Team leadership'],
    },
  }), explicitContext)
  assert.equal(missing.components.core_requirements.education_requirement_explicit, true)
  assert.equal(missing.components.core_requirements.seniority_requirement_explicit, true)
  assert.ok(missing.components.core_requirements.missing_count >= 2)
  assert.ok(missing.final_score < baseline.final_score)
})

test('inclusive experience, ambiguous remote location, and confirmed onsite mismatch are factual', () => {
  const remoteBoundary = scoreCandidateWithV3Shadow(excellentCandidate({ years_experience: 7 }), jd())
  assert.equal(remoteBoundary.components.experience_alignment.classification, 'within_range')
  assert.equal(remoteBoundary.components.location_alignment.classification, 'unknown')
  assert.equal(remoteBoundary.adjustments.confirmed_location_penalty, 0)

  const onsite = jd({ location: 'Bengaluru', employmentType: 'On-site' })
  const mismatch = scoreCandidateWithV3Shadow(excellentCandidate({ location: 'Kochi' }), onsite)
  assert.equal(mismatch.components.location_alignment.classification, 'mismatch')
  assert.equal(mismatch.adjustments.confirmed_location_penalty, 8)
  assert.ok(mismatch.final_score < remoteBoundary.final_score)
})

test('material core and experience gaps keep low-fit candidates below strong bands', () => {
  const low = scoreCandidateWithV3Shadow({
    years_experience: 1.5,
    location: 'Kochi',
    skills_flat: ['Manual testing'],
    experience: ['Executed manual QA test cases.'],
    fit_assessment: {
      matched_requirements: [],
      missing_requirements: ['Node.js or Java', 'PostgreSQL', 'Production APIs'],
    },
    missingSkills: ['Node.js', 'Java', 'PostgreSQL'],
  }, jd())

  assert.ok(low.final_score < 70)
  assert.equal(low.score_band, 'low')
  assert.ok(low.diagnostic_codes.includes('material_core_requirement_gaps'))
  assert.ok(low.diagnostic_codes.includes('below_minimum_experience'))
})

test('shadow contract contains only bounded numeric and coded diagnostics, never resume PII', () => {
  const result = scoreCandidateWithV3Shadow(excellentCandidate({
    name: 'Sensitive Person',
    email: 'sensitive@example.com',
    phone: '+91 99999 99999',
  }), jd())
  const serialized = JSON.stringify(result)

  assert.equal(serialized.includes('Sensitive Person'), false)
  assert.equal(serialized.includes('sensitive@example.com'), false)
  assert.equal(serialized.includes('99999'), false)
  assert.equal(result.diagnostic_codes.every((code) => /^[a-z0-9_]+$/.test(code)), true)
})

test('contract normalization allowlists fields and diagnostic codes before persistence', () => {
  const normalized = normalizeV3ShadowContract({
    ...scoreCandidateWithV3Shadow(excellentCandidate(), jd()),
    candidate_name: 'Sensitive Person',
    evidence: 'sensitive@example.com built the platform',
    diagnostic_codes: ['core_requirement_gap', 'Sensitive Person'],
    components: {
      ...scoreCandidateWithV3Shadow(excellentCandidate(), jd()).components,
      raw_resume_text: 'Sensitive Person +91 99999 99999',
    },
  })
  const serialized = JSON.stringify(normalized)

  assert.deepEqual(normalized.diagnostic_codes, ['core_requirement_gap'])
  assert.equal(serialized.includes('Sensitive Person'), false)
  assert.equal(serialized.includes('sensitive@example.com'), false)
  assert.equal(serialized.includes('99999'), false)
})

test('missing JD skips cleanly without fabricating a role-fit score', () => {
  const result = scoreCandidateWithV3Shadow(excellentCandidate(), null)
  assert.equal(result.status, 'skipped_no_job_description')
  assert.equal(result.final_score, null)
})
