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
    education: [{ degree: 'MBA', school: 'Example University', graduation_year: 2010 }],
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
  assert.deepEqual(candidate.education, ['MBA, Example University (2010)'])
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

test('normalizeCompactAnalysis maps concerns-only payloads into considerations for compatibility', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{ concerns: ['No production ownership evidence'] }],
  })

  assert.deepEqual(result.candidates[0].concerns, ['No production ownership evidence'])
  assert.deepEqual(result.candidates[0].considerations, ['No production ownership evidence'])
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

test('normalizeCompactAnalysis does not coerce structured education objects to display artifacts', () => {
  const result = normalizeCompactAnalysis({
    candidates: [{
      education: [
        { degree: 'M.Tech', school: 'IIT Bombay', graduation_year: '2020' },
        '[object Object]',
        { label: 'Executive Education, Example School' },
      ],
    }],
  })

  assert.deepEqual(result.candidates[0].education, [
    'M.Tech, IIT Bombay (2020)',
    'Executive Education, Example School',
  ])
})

test('canonicalizeCandidateScoreFields flag off preserves current score fields exactly', () => {
  const candidate = {
    score: 72,
    profile_score: 90,
    fit_assessment: { has_job_description_context: true, overall_fit_score: 78 },
    matchScore: { score: 82, score_out_of_ten: 7.1, fit: 'Strong', reason: 'Good fit' },
  }

  const output = __testables.canonicalizeCandidateScoreFields(candidate, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'false' },
  })

  assert.strictEqual(output, candidate)
  assert.deepEqual(output, candidate)
  assert.equal(output.scoring_contract_version, undefined)
  assert.equal(output.canonical_score_source, undefined)
  assert.equal(output.canonical_score_context, undefined)
})

test('canonicalizeCandidateScoreFields derives score_out_of_ten app-side when enabled', () => {
  const output = __testables.canonicalizeCandidateScoreFields({
    score: 72,
    profile_score: 90,
    fit_assessment: { has_job_description_context: true, overall_fit_score: 78 },
    matchScore: { score: 82, score_out_of_ten: 1.5, fit: 'Strong', reason: 'Good fit' },
  }, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
  })

  assert.equal(output.score, 82)
  assert.equal(output.matchScore.score, 82)
  assert.equal(output.matchScore.score_out_of_ten, 8.2)
})

test('canonicalizeCandidateScoreFields aligns JD fit score fields and metadata when enabled', () => {
  const output = __testables.canonicalizeCandidateScoreFields({
    score: 72,
    profile_score: 90,
    fit_assessment: { has_job_description_context: true, overall_fit_score: 78 },
    matchScore: { score: 82, score_out_of_ten: 7.1, fit: 'Strong', reason: 'Good fit' },
  }, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'TRUE' },
  })

  assert.equal(output.score, 82)
  assert.equal(output.matchScore.score, 82)
  assert.equal(output.matchScore.score_out_of_ten, 8.2)
  assert.equal(output.fit_assessment.overall_fit_score, 82)
  assert.equal(output.scoring_contract_version, 'canonical_score_fields_v1')
  assert.equal(output.canonical_score_source, 'matchScore.score')
  assert.equal(output.canonical_score_context, 'jd_fit')
})

test('canonicalizeCandidateScoreFields falls back to candidate.score for JD fit when matchScore is missing', () => {
  const output = __testables.canonicalizeCandidateScoreFields({
    score: 74,
    profile_score: 91,
    fit_assessment: { has_job_description_context: true, overall_fit_score: 66 },
    matchScore: null,
  }, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
  })

  assert.equal(output.score, 74)
  assert.deepEqual(output.matchScore, { score: 74, score_out_of_ten: 7.4 })
  assert.equal(output.fit_assessment.overall_fit_score, 74)
  assert.equal(output.canonical_score_source, 'candidate.score')
  assert.equal(output.canonical_score_context, 'jd_fit')
})

test('canonicalizeCandidateScoreFields does not fall back to profile_score when JD match score is missing', () => {
  const output = __testables.canonicalizeCandidateScoreFields({
    profile_score: 91,
    fit_assessment: { has_job_description_context: true, overall_fit_score: null },
    matchScore: { score: null, score_out_of_ten: null },
  }, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
  })

  assert.equal(output.score, undefined)
  assert.equal(output.matchScore.score, null)
  assert.equal(output.matchScore.score_out_of_ten, null)
  assert.equal(output.canonical_score_source, 'missing')
  assert.equal(output.canonical_score_context, 'jd_fit')
})

test('canonicalizeCandidateScoreFields preserves JD-missing semantics while using profile_score as candidate score', () => {
  const output = __testables.canonicalizeCandidateScoreFields({
    score: 0,
    profile_score: 78,
    matchScore: null,
    fit_assessment: { has_job_description_context: false, overall_fit_score: null, notes: ['job_description_missing'] },
  }, {
    jobDescriptionContext: { hasContext: false },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
  })

  assert.equal(output.score, 78)
  assert.equal(output.matchScore, null)
  assert.equal(output.fit_assessment.overall_fit_score, null)
  assert.equal(output.canonical_score_source, 'profile_score')
  assert.equal(output.canonical_score_context, 'profile_only')
})

test('canonicalizeCandidateScoreFields does not coerce null blank or non-numeric scores to zero', () => {
  for (const value of [null, '', '   ', 'not-a-number']) {
    const output = __testables.canonicalizeCandidateScoreFields({
      score: undefined,
      profile_score: value,
      matchScore: null,
    }, {
      jobDescriptionContext: { hasContext: false },
      env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
    })

    assert.equal(output.score, undefined)
    assert.equal(output.matchScore, null)
    assert.equal(output.canonical_score_source, 'missing')
    assert.equal(output.canonical_score_context, 'profile_only')
  }
})
