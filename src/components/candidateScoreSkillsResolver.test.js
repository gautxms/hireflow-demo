import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCandidateScoreBreakdown } from './candidateScoreSkillsResolver.js'

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
