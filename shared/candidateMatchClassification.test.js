import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCandidateMatchScore,
  resolveCandidateMatchLabel,
  resolveCandidateMatchTier,
} from './candidateMatchClassification.js'

test('candidate match classification is canonical across 10-point and percentage scores', () => {
  assert.equal(normalizeCandidateMatchScore(78), 7.8)
  assert.equal(resolveCandidateMatchTier(7.8), 'possible')
  assert.equal(resolveCandidateMatchLabel(7.8), 'Possible match')
  assert.equal(resolveCandidateMatchLabel(6.8), 'Possible match')
  assert.equal(resolveCandidateMatchLabel(8), 'Strong match')
  assert.equal(resolveCandidateMatchLabel(59), 'Low match')
  assert.equal(resolveCandidateMatchLabel(null), 'Unable to score')
  assert.equal(resolveCandidateMatchLabel(''), 'Unable to score')
})
