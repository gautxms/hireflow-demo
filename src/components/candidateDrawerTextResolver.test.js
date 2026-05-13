import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeByComparableText, normalizeComparableTextKey, resolveCandidateReasoning, resolveCandidateVerdict } from './candidateDrawerTextResolver.js'

test('normalizeComparableTextKey produces comparable keys for punctuation variants', () => {
  assert.equal(normalizeComparableTextKey('Strong fit — React/Node.'), normalizeComparableTextKey('strong fit react node'))
})


test('normalizeComparableTextKey preserves skill-significant punctuation', () => {
  assert.notEqual(normalizeComparableTextKey('C'), normalizeComparableTextKey('C++'))
  assert.notEqual(normalizeComparableTextKey('C'), normalizeComparableTextKey('C#'))
  assert.notEqual(normalizeComparableTextKey('C++'), normalizeComparableTextKey('C#'))
})

test('resolveCandidateReasoning suppresses duplicate sentence already used as verdict', () => {
  const candidate = {
    summary: 'Strong fit for backend role.',
    matchScore: {
      fit: 'strong fit',
      reason: 'Strong fit for backend role. Demonstrated API ownership at scale.',
    },
  }

  const verdict = resolveCandidateVerdict(candidate)
  const reasoning = resolveCandidateReasoning(candidate, verdict)

  assert.equal(verdict, 'Strong fit for backend role.')
  assert.equal(reasoning, 'Demonstrated API ownership at scale.')
})

test('resolveCandidateVerdict returns meaningful fallback for legacy records', () => {
  const verdict = resolveCandidateVerdict({ current_title: 'Engineer', score: 72 })
  assert.match(verdict, /potential match/i)
})

test('resolveCandidateReasoning falls back to canonical rationale and risks_or_gaps', () => {
  const reasoning = resolveCandidateReasoning({
    fit_assessment: {
      rationale: 'Demonstrates strong ownership across complex projects.',
      risks_or_gaps: 'Depth in distributed systems is uncertain.',
    },
  })

  assert.match(reasoning, /strong ownership/i)
  assert.match(reasoning, /distributed systems/i)
})

test('dedupeByComparableText removes repeated lines when summary and reason are identical', () => {
  const duplicated = ['Excellent SQL depth.', 'Excellent SQL depth', 'Excellent SQL depth.']
  assert.deepEqual(dedupeByComparableText(duplicated), ['Excellent SQL depth.'])

  const candidate = {
    summary: 'Excellent SQL depth.',
    matchScore: { reason: 'Excellent SQL depth.' },
  }
  const verdict = resolveCandidateVerdict(candidate)
  const reasoning = resolveCandidateReasoning(candidate, verdict)
  assert.equal(reasoning, 'Reasoning unavailable for this profile.')
})
