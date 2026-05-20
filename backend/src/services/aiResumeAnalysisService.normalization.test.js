import test from 'node:test'
import assert from 'node:assert/strict'

import { __testables } from './aiResumeAnalysisService.js'

const { normalizeCompactAnalysis } = __testables

test('normalizeCompactAnalysis preserves rich candidate fields in compact pipeline', () => {
  const fixtureCandidate = {
    name: 'Rahul B. Yadav',
    years_experience: 15,
    profile_score: 80,
    seniority_level: 'Senior',
    tags: ['Capital Markets', 'Business Analysis', 'Derivatives'],
    top_skills: ['Agile', 'Scrum', 'Capital Markets', 'Derivatives', 'Fixed Income'],
    skills: {
      tools_and_platforms: ['Jira', 'Confluence', 'SQL'],
      methodologies: ['Agile', 'Scrum', 'Waterfall', 'Kanban'],
      domain_expertise: ['Capital Markets', 'Derivatives', 'Fixed Income', 'EMIR'],
      soft_skills: ['Stakeholder Management', 'Communication'],
    },
    fit_assessment: {
      has_job_description_context: true,
      overall_fit_score: 82,
      matched_requirements: ['Business analysis', 'Capital Markets'],
      missing_requirements: ['Power BI'],
      risks_or_gaps: ['Power BI is not mentioned in the resume'],
      rationale: 'Strong BA profile with capital markets experience.',
      notes: [],
    },
    matchScore: {
      score: 82,
      score_out_of_ten: 8.2,
      fit: 'Strong match',
      reason: 'Strong capital markets BA profile.',
      breakdown: {},
    },
    confidence: {
      name: 1,
      skills: 0.9,
      experience: 0.9,
      education: 0.7,
      fit_assessment: 0.8,
    },
    location: 'London',
    summary: 'Experienced BA in capital markets.',
    strengths: ['Domain depth'],
    considerations: ['Power BI not listed'],
    education: ['MBA'],
    experience: ['Lead BA - 10 years'],
    certifications: ['CBAP'],
    languages: ['English'],
    projects: ['MiFID II transformation'],
    achievements: ['Reduced settlement breaks by 15%'],
  }

  const result = normalizeCompactAnalysis({ candidates: [fixtureCandidate] })
  const candidate = result.candidates[0]

  assert.equal(candidate.years_experience, 15)
  assert.equal(candidate.profile_score, 80)
  assert.equal(candidate.seniority_level, 'Senior')
  assert.deepEqual(candidate.tags, fixtureCandidate.tags)
  assert.deepEqual(candidate.top_skills, fixtureCandidate.top_skills)
  assert.deepEqual(candidate.skills, fixtureCandidate.skills)
  assert.deepEqual(candidate.fit_assessment, fixtureCandidate.fit_assessment)
  assert.deepEqual(candidate.matchScore, fixtureCandidate.matchScore)
  assert.deepEqual(candidate.confidence, fixtureCandidate.confidence)
  assert.deepEqual(candidate.education, fixtureCandidate.education)
  assert.deepEqual(candidate.experience, fixtureCandidate.experience)
  assert.deepEqual(candidate.certifications, fixtureCandidate.certifications)
  assert.deepEqual(candidate.languages, fixtureCandidate.languages)
  assert.deepEqual(candidate.projects, fixtureCandidate.projects)
  assert.deepEqual(candidate.achievements, fixtureCandidate.achievements)
  assert.equal(candidate.location, fixtureCandidate.location)
  assert.equal(candidate.summary, fixtureCandidate.summary)
  assert.deepEqual(candidate.strengths, fixtureCandidate.strengths)
  assert.deepEqual(candidate.considerations, fixtureCandidate.considerations)
})


test('normalizeCompactAnalysis maps considerations only without duplicating concerns', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{ considerations: ['Probe system design depth'] }],
  })

  assert.deepEqual(result.candidates[0].considerations, ['Probe system design depth'])
  assert.deepEqual(result.candidates[0].concerns, [])
})

test('normalizeCompactAnalysis maps concerns only without duplicating considerations', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{ concerns: ['No production ownership evidence'] }],
  })

  assert.deepEqual(result.candidates[0].concerns, ['No production ownership evidence'])
  assert.deepEqual(result.candidates[0].considerations, [])
})

test('normalizeCompactAnalysis maps concerns from fit_assessment.risks_or_gaps when candidate.concerns is missing', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{
      considerations: ['Ask about stakeholder conflict handling'],
      fit_assessment: { risks_or_gaps: ['No Terraform experience listed'] },
    }],
  })

  assert.deepEqual(result.candidates[0].considerations, ['Ask about stakeholder conflict handling'])
  assert.deepEqual(result.candidates[0].concerns, ['No Terraform experience listed'])
})

test('normalizeCompactAnalysis keeps concerns and considerations separate when both exist', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{
      considerations: ['Ask for largest dataset handled'],
      concerns: ['Frequent short tenures over last 2 years'],
      fit_assessment: { risks_or_gaps: ['Should not override candidate.concerns'] },
    }],
  })

  assert.deepEqual(result.candidates[0].considerations, ['Ask for largest dataset handled'])
  assert.deepEqual(result.candidates[0].concerns, ['Frequent short tenures over last 2 years'])
})

test('normalizeCompactAnalysis defaults both concerns and considerations to arrays when missing', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{}],
  })

  assert.deepEqual(result.candidates[0].considerations, [])
  assert.deepEqual(result.candidates[0].concerns, [])
})
