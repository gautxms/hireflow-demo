import test from 'node:test'
import assert from 'node:assert/strict'

import { getCandidateValidationFailureReasons, isCandidateValidForScoredOutcome, isFailureNarrativeCandidate } from './candidateValidation.js'

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

test('borderline model output with partial evidence remains acceptable', () => {
  const candidate = {
    summary: 'Some sections were noisy but work history and skills were extracted.',
    reasoning: 'Candidate matches core backend requirements and has relevant project depth.',
    score: 61,
    skills_flat: ['Node.js', 'PostgreSQL'],
    education: [],
    experienceEvidence: ['Built API services in production'],
    fitStatus: 'potential_fit',
  }

  assert.deepEqual(getCandidateValidationFailureReasons(candidate), [])
  assert.equal(isCandidateValidForScoredOutcome(candidate), true)
})

test('candidate with structured skills object remains valid', () => {
  const candidate = {
    summary: 'Backend engineer with cloud deployment experience.',
    reasoning: 'Candidate aligns with Node.js, AWS, and CI/CD requirements.',
    score: 79,
    skills: {
      languages_and_frameworks: ['Node.js', 'Express'],
      tools_and_platforms: ['AWS', 'Docker'],
      domains: ['Fintech'],
    },
    skills_structured: {
      languages_and_frameworks: ['Node.js', 'Express'],
      tools_and_platforms: ['AWS', 'Docker'],
      domains: ['Fintech'],
    },
    education: [{ degree: 'B.S. Computer Science' }],
    experienceEvidence: ['Shipped and maintained production APIs'],
    fitStatus: 'good_fit',
  }

  assert.deepEqual(getCandidateValidationFailureReasons(candidate), [])
  assert.equal(isCandidateValidForScoredOutcome(candidate), true)
})

test('overly strict borderline output is rejected with explicit failure reasons', () => {
  const candidate = {
    summary: 'Parser uncertainty detected for multiple fields.',
    score: 105,
    skills_flat: 'Node.js,SQL',
    education: {},
    experienceEvidence: 'five years claimed',
    fitStatus: 'excellent_fit',
    matchScore: 'likely fit',
  }

  assert.deepEqual(
    getCandidateValidationFailureReasons(candidate),
    [
      'score_out_of_range',
      'match_score_malformed',
      'skills_flat_malformed_array',
      'education_malformed_array',
      'experience_evidence_malformed_array',
      'fit_status_enum_mismatch',
    ],
  )
  assert.equal(isCandidateValidForScoredOutcome(candidate), false)
})
