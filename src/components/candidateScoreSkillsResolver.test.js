import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCandidateScoreBreakdown, resolveSkillSignals } from './candidateScoreSkillsResolver.js'

test('resolveCandidateScoreBreakdown returns items for a real trusted breakdown payload', () => {
  const result = resolveCandidateScoreBreakdown({
    scoreBreakdown: {
      skills_alignment: 84,
      experience_alignment: 78,
      education_alignment: 72,
      overall: 78,
      fabricated_field: 99,
    },
  })

  assert.equal(result.isValid, true)
  assert.deepEqual(result.items, [
    { label: 'Skills alignment', value: 84 },
    { label: 'Experience alignment', value: 78 },
    { label: 'Education alignment', value: 72 },
    { label: 'Overall score', value: 78 },
  ])
})

test('resolveCandidateScoreBreakdown accepts canonical matchScore.breakdown', () => {
  const result = resolveCandidateScoreBreakdown({
    matchScore: {
      breakdown: {
        skills_alignment: 90,
        experience_alignment: 87,
        education_alignment: 84,
        overall: 87,
      },
    },
  })

  assert.equal(result.isValid, true)
  assert.equal(result.items.length, 4)
})

test('resolveCandidateScoreBreakdown rejects malformed breakdown payload', () => {
  const result = resolveCandidateScoreBreakdown({
    score_breakdown: {
      skills_alignment: 90,
      experience_alignment: '80',
      education_alignment: 70,
      overall: 80,
    },
  })

  assert.equal(result.isValid, false)
  assert.deepEqual(result.items, [])
})

test('resolveCandidateScoreBreakdown rejects absent breakdown payload', () => {
  const result = resolveCandidateScoreBreakdown({
    name: 'No breakdown candidate',
  })

  assert.equal(result.isValid, false)
  assert.deepEqual(result.items, [])
})

test('resolveSkillSignals prefers canonical matched/missing requirement sources', () => {
  const result = resolveSkillSignals({
    fit_assessment: {
      matched_requirements: ['React', 'TypeScript'],
      missing_requirements: ['Kubernetes'],
    },
    top_skills: ['React'],
  })

  assert.equal(result.label, 'MATCHED SKILLS')
  assert.deepEqual(result.primarySkills, ['React', 'TypeScript'])
  assert.deepEqual(result.skillGaps, ['Kubernetes'])
  assert.equal(result.source, 'explicit')
})

test('resolveSkillSignals infers relevant skills when explicit matched list is absent', () => {
  const result = resolveSkillSignals({
    top_skills: ['GraphQL', 'SQL'],
  })

  assert.equal(result.label, 'RELEVANT SKILLS')
  assert.deepEqual(result.primarySkills, ['GraphQL', 'SQL'])
  assert.equal(result.source, 'inferred')
  assert.equal(result.confidence, 'medium')
})

test('resolveSkillSignals handles empty skill payloads', () => {
  const result = resolveSkillSignals({})

  assert.equal(result.label, 'RELEVANT SKILLS')
  assert.deepEqual(result.primarySkills, [])
  assert.equal(result.source, 'none')
  assert.equal(result.confidence, 'low')
})

test('resolveSkillSignals falls back to legacy skill arrays when canonical arrays are empty', () => {
  const result = resolveSkillSignals({
    fit_assessment: {
      matched_requirements: [],
      missing_requirements: [],
      matched: ['Legacy Match'],
      missing: ['Legacy Gap'],
    },
    matchedSkills: ['Matched Skills Fallback'],
    missing_skills: ['Missing Skills Fallback'],
  })

  assert.deepEqual(result.primarySkills, ['Matched Skills Fallback'])
  assert.deepEqual(result.skillGaps, ['Missing Skills Fallback'])
  assert.equal(result.source, 'explicit')
})
