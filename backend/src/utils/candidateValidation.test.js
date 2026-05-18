import test from 'node:test'
import assert from 'node:assert/strict'

import { isCandidateValidForScoredOutcome, isFailureNarrativeCandidate } from './candidateValidation.js'

test('failure-narrative candidate is rejected even when score > 0', () => {
  const candidate = {
    summary: 'Resume content is not extractable from PDF. Unable to assess candidate.',
    reasoning: 'PDF parsing failed. No resume content available for JD comparison.',
    resumeWarnings: ['Resume PDF is unreadable; content extraction failed.'],
    score: 15,
    skills_flat: [],
    education: [],
    experienceEvidence: [],
    years_experience: null,
    totalExperienceYears: null,
    relevantExperienceYears: null,
  }

  assert.equal(isFailureNarrativeCandidate(candidate), true)
  assert.equal(isCandidateValidForScoredOutcome(candidate), false)
})

test('meaningful scored candidate remains valid', () => {
  const candidate = {
    summary: 'Business analyst with 5 years in fintech.',
    reasoning: 'Matches SQL, Agile and stakeholder management requirements.',
    score: 72,
    skills_flat: ['SQL', 'Agile', 'JIRA'],
    education: [{ degree: 'B.Tech' }],
    years_experience: 5,
  }

  assert.equal(isFailureNarrativeCandidate(candidate), false)
  assert.equal(isCandidateValidForScoredOutcome(candidate), true)
})
