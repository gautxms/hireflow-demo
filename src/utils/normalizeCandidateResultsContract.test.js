import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCandidateResultsContract } from './normalizeCandidateResultsContract.js'

test('score fallback precedence is stable and bounded', () => {
  const normalized = normalizeCandidateResultsContract({
    matchScore: { score: 81, reason: 'primary' },
    score: 72,
    profile_score: 65,
  })
  assert.equal(normalized.score, 81)
  assert.equal(normalized.matchScore.score, 81)

  const clamped = normalizeCandidateResultsContract({ matchScore: 150 })
  assert.equal(clamped.score, 100)
})

test('matchScore normalizes to object shape for legacy numeric values', () => {
  const normalized = normalizeCandidateResultsContract({ matchScore: 64 })
  assert.deepEqual(Object.keys(normalized.matchScore).sort(), ['reason', 'score'])
  assert.equal(normalized.matchScore.score, 64)
  assert.equal(typeof normalized.matchScore.reason, 'string')
})

test('reason fallback behavior prefers fit_assessment then summary then default', () => {
  const fromFit = normalizeCandidateResultsContract({
    score: 45,
    fit_assessment: { reason: 'Fit reason wins' },
    summary: 'summary fallback',
  })
  assert.equal(fromFit.matchScore.reason, 'Fit reason wins')

  const fromSummary = normalizeCandidateResultsContract({ score: 45, summary: 'summary fallback' })
  assert.equal(fromSummary.matchScore.reason, 'summary fallback')

  const defaulted = normalizeCandidateResultsContract({ score: 45 })
  assert.match(defaulted.matchScore.reason, /Reasoning unavailable/)
})

test('bare minimum payloads remain renderable with omitted rich fields', () => {
  const normalized = normalizeCandidateResultsContract({
    analysis_mode: 'bare_minimum',
    name: 'Lean Candidate',
    score: 77,
    summary: 'Concise summary',
    matchedSkills: ['Node.js'],
    fit_assessment: null,
    top_skills: null,
  })

  assert.equal(normalized.analysis_mode, 'bare_minimum')
  assert.deepEqual(normalized.top_skills, [])
  assert.deepEqual(normalized.fit_assessment.matched, [])
  assert.deepEqual(normalized.fit_assessment.missing, [])
  assert.equal(normalized.name, 'Lean Candidate')
})
