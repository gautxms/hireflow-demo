import test from 'node:test'
import assert from 'node:assert/strict'

import { __testables } from './parseResumeJob.js'

const { buildNormalizedCandidates } = __testables

test('buildNormalizedCandidates preserves structured candidate contract fields', () => {
  const fixtureCandidate = {
    name: 'Rahul B. Yadav',
    email: 'rahul@example.com',
    phone: null,
    location: 'Mumbai',
    summary: 'Senior Business Analyst with 15 years of IT experience.',
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
    strengths: ['15 years of IT experience in business analysis'],
    considerations: ['Clarify recent hands-on ownership of delivery outcomes'],
    concerns: ['Power BI is not explicitly mentioned in the resume'],
    education: [{ degree: 'MBA', school: 'Example University', graduation_year: 2010 }],
    experience: [{ title: 'Senior Business Analyst', company: 'Example Corp', duration: '2010-2025', startDate: '2010-01', endDate: '2025-01' }],
    certifications: ['CSM'],
    languages: ['English'],
    projects: [{ name: 'Trading platform migration', description: 'Capital markets migration project', url: null }],
    achievements: ['Led requirements for derivatives platform'],
    fit_assessment: {
      has_job_description_context: true,
      overall_fit_score: 82,
      skill_match_score: 80,
      experience_match_score: 90,
      education_match_score: 70,
      location_match_score: 70,
      matched_requirements: ['Business analysis', 'Capital Markets'],
      missing_requirements: ['Power BI'],
      risks_or_gaps: ['Power BI is not explicitly mentioned in the resume'],
      rationale: 'Strong match based on BA and capital markets experience.',
      notes: [],
    },
    matchScore: {
      score: 82,
      score_out_of_ten: 8.2,
      fit: 'Strong match',
      reason: 'Strong capital markets BA profile with 15 years of experience.',
      breakdown: {},
    },
    confidence: {
      name: 1,
      email: 0.8,
      phone: 0.2,
      location: 0.8,
      summary: 0.9,
      skills: 0.9,
      experience: 0.9,
      education: 0.7,
      fit_assessment: 0.8,
    },
  }

  const [candidate] = buildNormalizedCandidates({ candidates: [fixtureCandidate] }, { resumeId: 'resume-1', filename: 'rahul.pdf' })

  assert.equal(candidate.years_experience, 15)
  assert.equal(candidate.profile_score, 80)
  assert.equal(candidate.seniority_level, 'Senior')
  assert.deepEqual(candidate.tags, fixtureCandidate.tags)
  assert.deepEqual(candidate.top_skills, fixtureCandidate.top_skills)

  assert.deepEqual(candidate.skills, fixtureCandidate.skills)
  assert.equal(Object.keys(candidate.skills).length, 4)
  assert.deepEqual(candidate.skills.methodologies, ['Agile', 'Scrum', 'Waterfall', 'Kanban'])
  assert.deepEqual(candidate.skills.domain_expertise, ['Capital Markets', 'Derivatives', 'Fixed Income', 'EMIR'])
  assert.deepEqual(candidate.skills.soft_skills, ['Stakeholder Management', 'Communication'])
  assert.deepEqual(candidate.skills.tools_and_platforms, ['Jira', 'Confluence', 'SQL'])
  assert.equal(candidate.skills.tools_and_platforms.includes('Power BI'), false)

  assert.deepEqual(candidate.fit_assessment, fixtureCandidate.fit_assessment)
  assert.deepEqual(candidate.matchScore, fixtureCandidate.matchScore)
  assert.deepEqual(candidate.confidenceScores, fixtureCandidate.confidence)

  assert.deepEqual(candidate.considerations, fixtureCandidate.considerations)
  assert.deepEqual(candidate.concerns, fixtureCandidate.concerns)

  assert.deepEqual(candidate.education, fixtureCandidate.education)
  assert.deepEqual(candidate.experience, fixtureCandidate.experience)
  assert.deepEqual(candidate.certifications, fixtureCandidate.certifications)
  assert.deepEqual(candidate.languages, fixtureCandidate.languages)
  assert.deepEqual(candidate.projects, fixtureCandidate.projects)
  assert.deepEqual(candidate.achievements, fixtureCandidate.achievements)
})
