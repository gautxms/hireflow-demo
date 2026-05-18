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


test('candidate with extracted experience is not treated as failure narrative', () => {
  const candidate = {
    summary: 'Unable to assess some sections due to formatting issues.',
    reasoning: 'Parser flagged uncertainty for one subsection.',
    score: 40,
    skills_flat: [],
    education: [],
    experienceEvidence: [],
    experience: [{ title: 'Software Engineer', company: 'Acme Corp' }],
  }

  assert.equal(isFailureNarrativeCandidate(candidate), false)
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


test('AG-style failure narrative with scored status is rejected', () => {
  const candidate = {
    summary: 'PDF parsing failed and content is not extractable.',
    reasoning: 'No work history, skills, education, or achievements are readable.',
    resumeProcessingStatus: 'scored',
    score: 15,
    skills_flat: [],
    education: [],
    experience: null,
    years_experience: null,
  }

  assert.equal(isFailureNarrativeCandidate(candidate), true)
  assert.equal(isCandidateValidForScoredOutcome(candidate), false)
})
