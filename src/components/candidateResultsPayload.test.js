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

test('normalizes canonical fit_assessment fields into legacy aliases while preserving canonicals', () => {
  const payload = normalizeCandidateResultsPayload({
    candidates: [{
      fit_assessment: {
        matched_requirements: ['React'],
        missing_requirements: ['Kubernetes'],
        risks_or_gaps: 'No production-scale Kubernetes example.',
        rationale: 'Strong frontend depth and leadership evidence.',
      },
    }],
  })

  const [candidate] = payload.candidates
  assert.deepEqual(candidate.fit_assessment.matched_requirements, ['React'])
  assert.deepEqual(candidate.fit_assessment.matched, ['React'])
  assert.deepEqual(candidate.fit_assessment.missing_requirements, ['Kubernetes'])
  assert.deepEqual(candidate.fit_assessment.missing, ['Kubernetes'])
  assert.equal(candidate.fit_assessment.risks_or_gaps, 'No production-scale Kubernetes example.')
  assert.equal(candidate.fit_assessment.uncertainty, 'No production-scale Kubernetes example.')
  assert.equal(candidate.fit_assessment.reason, 'Strong frontend depth and leadership evidence.')
})

test('normalizes skill contract fields with backward-compatible aliases', () => {
  const payload = normalizeCandidateResultsPayload({
    candidates: [{
      all_extracted_skills: ['React', 'Node.js', 'Kubernetes'],
      matched_skills: ['React'],
      fit_assessment: { missing_requirements: ['Kubernetes'] },
    }],
  })

  const [candidate] = payload.candidates
  assert.deepEqual(candidate.allExtractedSkills, ['React', 'Node.js', 'Kubernetes'])
  assert.deepEqual(candidate.matchedSkills, ['React'])
  assert.deepEqual(candidate.missingRequirements, ['Kubernetes'])
  assert.deepEqual(candidate.all_extracted_skills, ['React', 'Node.js', 'Kubernetes'])
})
