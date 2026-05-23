import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCandidateResultsPayload } from './candidateResultsPayload.js'

test('normalizes invalid payload to empty shape', () => {
  assert.deepEqual(normalizeCandidateResultsPayload(null), {
    candidates: [],
    parseMeta: {},
    isInvalid: false,
  })

  assert.deepEqual(normalizeCandidateResultsPayload('bad'), {
    candidates: [],
    parseMeta: {},
    isInvalid: true,
  })
})

test('normalizes payload candidates and parseMeta object', () => {
  const payload = normalizeCandidateResultsPayload({
    candidates: [{ id: '1' }],
    parseMeta: { hasJobDescription: true },
  })

  assert.equal(payload.isInvalid, false)
  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.parseMeta.hasJobDescription, true)
  assert.equal(payload.candidates[0].matchScore.score, 0)
  assert.equal(typeof payload.candidates[0].matchScore.reason, 'string')
})

test('preserves match breakdown and fit assessment score fields for score breakdown rendering', () => {
  const payload = normalizeCandidateResultsPayload({
    candidates: [{
      id: 'score-1',
      matchScore: {
        score: 92,
        breakdown: {
          skill_match_score: '86%',
          experience_match_score: 0.72,
          education_match_score: '(80%)',
          role_alignment: 67,
        },
      },
      fit_assessment: {
        skill_match_score: 86,
        experience_match_score: 72,
        education_match_score: 80,
        role_alignment: 67,
      },
    }],
  })

  const candidate = payload.candidates[0]
  assert.equal(candidate.matchScore.breakdown.skill_match_score, '86%')
  assert.equal(candidate.matchScore.breakdown.experience_match_score, 0.72)
  assert.equal(candidate.fit_assessment.skill_match_score, 86)
  assert.equal(candidate.fit_assessment.experience_match_score, 72)
  assert.equal(candidate.fit_assessment.education_match_score, 80)
  assert.equal(candidate.fit_assessment.role_alignment, 67)
})
