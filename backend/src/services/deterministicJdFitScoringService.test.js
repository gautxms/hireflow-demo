import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { scoreCandidateDeterministically } from './deterministicJdFitScoringService.js'

const jdContext = () => ({ location: 'Austin, TX', required_min_years: 4, required_max_years: 8 })

const candidate = () => ({
  fit_assessment: {
    matched_requirements: ['Node.js', 'APIs', 'SQL'],
    missing_requirements: ['Kubernetes'],
    risks_or_gaps: ['No Kubernetes evidence'],
  },
  matchedSkills: ['Node.js', 'SQL'],
  missingSkills: ['Kubernetes'],
  skills_flat: ['Node.js', 'SQL', 'React'],
  top_skills: ['APIs'],
  years_experience: 6,
  location: 'Austin, TX',
  confidence: { skills: 0.9, experience: 0.8, fit_assessment: 0.85 },
  profile_score: 80,
})

test('same input produces exactly same output every time', () => {
  const input = candidate()
  const first = scoreCandidateDeterministically(input, jdContext())
  assert.deepEqual(scoreCandidateDeterministically(input, jdContext()), first)
  assert.deepEqual(scoreCandidateDeterministically(input, jdContext()), first)
})

test('input candidate and JD context are not mutated', () => {
  const input = candidate()
  const context = jdContext()
  const beforeCandidate = structuredClone(input)
  const beforeContext = structuredClone(context)
  scoreCandidateDeterministically(input, context)
  assert.deepEqual(input, beforeCandidate)
  assert.deepEqual(context, beforeContext)
})

test('missing candidate fields do not crash', () => {
  assert.equal(scoreCandidateDeterministically({}, jdContext()).scoring_mode, 'jd_fit')
})

test('missing fit_assessment does not crash', () => {
  const input = candidate()
  delete input.fit_assessment
  assert.equal(scoreCandidateDeterministically(input, jdContext()).scoring_mode, 'jd_fit')
})

test('missing skills_flat/top_skills does not crash', () => {
  const input = candidate()
  delete input.skills_flat
  delete input.top_skills
  assert.equal(scoreCandidateDeterministically(input, jdContext()).scoring_breakdown.skill_alignment.candidate_skill_count, 0)
})

test('missing years_experience does not crash', () => {
  const input = candidate()
  delete input.years_experience
  const result = scoreCandidateDeterministically(input, jdContext())
  assert.equal(result.scoring_breakdown.experience_alignment.candidate_years, null)
})

test('JD-missing input does not produce fake jd_fit score', () => {
  assert.equal(scoreCandidateDeterministically(candidate(), null).scoring_mode, 'profile_only')
  assert.equal(scoreCandidateDeterministically({}, null).scoring_mode, 'insufficient_evidence')
  assert.equal(scoreCandidateDeterministically({}, null).final_score, null)
})

test('requirement ratio works', () => {
  const high = candidate()
  high.fit_assessment.matched_requirements = ['a', 'b', 'c']
  high.fit_assessment.missing_requirements = ['d']
  const low = candidate()
  low.fit_assessment.matched_requirements = ['a']
  low.fit_assessment.missing_requirements = ['b', 'c', 'd']
  assert.ok(scoreCandidateDeterministically(high, jdContext()).final_score > scoreCandidateDeterministically(low, jdContext()).final_score)
})

test('Vikram-like minor evidence count differences are dampened', () => {
  const vikramLike = ({
    matchedRequirementCount,
    missingRequirementCount,
    matchedSkillCount,
    missingSkillCount,
  }) => ({
    fit_assessment: {
      matched_requirements: Array.from({ length: matchedRequirementCount }, (_, index) => `matched requirement ${index}`),
      missing_requirements: Array.from({ length: missingRequirementCount }, (_, index) => `missing requirement ${index}`),
      risks_or_gaps: ['No cloud ownership evidence', 'No system design evidence'],
    },
    matchedSkills: Array.from({ length: matchedSkillCount }, (_, index) => `matched skill ${index}`),
    missingSkills: Array.from({ length: missingSkillCount }, (_, index) => `missing skill ${index}`),
    skills_flat: ['Java', 'SQL'],
    top_skills: ['Backend services'],
    years_experience: 4,
    location: 'Remote, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  })

  const docxLike = scoreCandidateDeterministically(vikramLike({
    matchedRequirementCount: 4,
    missingRequirementCount: 4,
    matchedSkillCount: 4,
    missingSkillCount: 4,
  }), sdeJdContext())
  const pdfLike = scoreCandidateDeterministically(vikramLike({
    matchedRequirementCount: 4,
    missingRequirementCount: 5,
    matchedSkillCount: 4,
    missingSkillCount: 5,
  }), sdeJdContext())

  assert.ok(docxLike.scoring_breakdown.requirement_match.score >= 45 && docxLike.scoring_breakdown.requirement_match.score <= 50)
  assert.ok(pdfLike.scoring_breakdown.requirement_match.score >= 44 && pdfLike.scoring_breakdown.requirement_match.score <= 49)
  assert.ok(docxLike.scoring_breakdown.skill_alignment.score >= 45 && docxLike.scoring_breakdown.skill_alignment.score <= 50)
  assert.ok(pdfLike.scoring_breakdown.skill_alignment.score >= 44 && pdfLike.scoring_breakdown.skill_alignment.score <= 49)
  assert.ok(Math.abs(docxLike.final_score - pdfLike.final_score) <= 4)
})


test('Vikram-like DOC/PDF/DOCX payloads keep experience capped and final scores close', () => {
  const vikramBase = ({ years, summary, matched = [], missing = [], matchedSkills = [], missingSkills = [] }) => ({
    summary,
    recommendation: 'Low fit due to experience gap against the target range.',
    matchScore: { reason: 'Candidate is below 2-5 years required experience.', breakdown: { experience: 'has 1.6 years' } },
    fit_assessment: {
      rationale: 'Early career profile with some backend exposure.',
      matched_requirements: matched,
      missing_requirements: missing,
      risks_or_gaps: ['Experience gap: 1.6 years is below minimum for 2-5 years', 'Junior profile for SDE ownership'],
    },
    matchedSkills,
    missingSkills,
    skills_flat: ['Java', 'SQL'],
    top_skills: ['Backend services'],
    years_experience: years,
    location: 'Remote, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  })
  const context = { ...sdeJdContext(), required_min_years: 2, required_max_years: 5 }
  const doc = scoreCandidateDeterministically(vikramBase({
    years: 1.6,
    summary: 'Candidate has 1.6 years experience and is below minimum.',
    matched: ['Java', 'SQL'],
    missing: ['2-5 years production experience', 'system design', 'cloud'],
    matchedSkills: ['Java', 'SQL'],
    missingSkills: ['2-5 years experience', 'system design', 'cloud'],
  }), context)
  const pdf = scoreCandidateDeterministically(vikramBase({
    years: 1.6,
    summary: 'Has 1.6 years; below target for the role.',
    matched: ['Java', 'SQL'],
    missing: ['minimum 2 years experience', 'system design', 'cloud', 'deployment'],
    matchedSkills: ['Java', 'SQL'],
    missingSkills: ['minimum 2 years experience', 'system design', 'cloud'],
  }), context)
  const docx = scoreCandidateDeterministically(vikramBase({
    years: 2,
    summary: 'AI normalization says 2 years, but notes state has 1.6 years and below 2-5 years.',
    matched: ['Java', 'SQL', 'backend services'],
    missing: ['2-5 years production experience', 'system design', 'cloud', 'deployment'],
    matchedSkills: ['Java', 'SQL', 'backend services'],
    missingSkills: ['2-5 years experience', 'system design', 'cloud'],
  }), context)

  for (const result of [doc, pdf, docx]) {
    assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 1.6)
    assert.equal(result.scoring_breakdown.experience_alignment.experience_shortfall_years, 0.4)
    assert.equal(result.scoring_breakdown.experience_alignment.score, 56)
    assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  }
  assert.notEqual(docx.scoring_breakdown.experience_alignment.score, 100)
  assert.ok(Math.max(doc.final_score, pdf.final_score, docx.final_score) - Math.min(doc.final_score, pdf.final_score, docx.final_score) <= 5)
})



test('DOCX/PDF/DOC explicit 1.6 years below 2-year minimum resolves consistently despite AI wording', () => {
  const context = { ...sdeJdContext(), required_min_years: 2, required_max_years: 5 }
  const base = ({ years, summary, missing, risks }) => ({
    summary,
    recommendation: 'Potential fit, but below the minimum experience for the role.',
    fit_assessment: {
      rationale: 'Backend exposure with early-career experience.',
      notes: ['Evidence says has 1.6 years.'],
      matched_requirements: ['Java', 'SQL', 'backend APIs'],
      missing_requirements: missing,
      risks_or_gaps: risks,
    },
    matchedSkills: ['Java', 'SQL', 'backend APIs'],
    missingSkills: missing,
    skills_flat: ['Java', 'SQL'],
    top_skills: ['Backend APIs'],
    years_experience: years,
    location: 'Remote, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  })

  const docx = scoreCandidateDeterministically(base({
    years: 2,
    summary: 'AI says meets minimum at lower boundary, but explicit evidence says has 1.6 years of experience.',
    missing: ['system design depth', 'cloud platforms', 'async/background jobs', 'auth/RBAC'],
    risks: ['0.4 years below minimum should not be treated as total experience', 'early career profile'],
  }), context)
  const pdf = scoreCandidateDeterministically(base({
    years: 1.6,
    summary: 'Candidate has 1.6 years of professional software experience; below 2-year minimum.',
    missing: ['system design', 'cloud platforms', 'async background jobs', 'auth and RBAC'],
    risks: ['Experience gap: has 1.6 years and is below the 2-year minimum'],
  }), context)
  const doc = scoreCandidateDeterministically(base({
    years: 1.6,
    summary: 'Has 1.6 years experience.',
    missing: ['no system design evidence', 'no cloud platform evidence', 'missing queue/background job depth', 'missing auth/RBAC ownership'],
    risks: ['Falls short of the 2-5 years target by 0.4 years', 'Junior profile with system design/cloud/queues/auth gaps'],
  }), context)

  for (const result of [docx, pdf, doc]) {
    const experience = result.scoring_breakdown.experience_alignment
    assert.equal(experience.below_min_experience_evidence_applied, true)
    assert.equal(experience.resolved_experience_years, 1.6)
    assert.equal(experience.required_min_years, 2)
    assert.equal(experience.experience_shortfall_years, 0.4)
    assert.equal(experience.experience_resolution_source, 'explicit_below_minimum_evidence')
    assert.equal(experience.score, 56)
  }

  const scores = [docx.final_score, pdf.final_score, doc.final_score]
  assert.ok(Math.max(...scores) - Math.min(...scores) <= 3)
})

test('skill-specific duration in summary does not override total experience', () => {
  const input = candidate()
  input.years_experience = 6
  input.summary = '6 years total engineering experience, including 1 year with Kubernetes'
  input.fit_assessment.risks_or_gaps = []
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 4 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, false)
  assert.equal(result.scoring_breakdown.experience_alignment.safer_candidate_years, 6)
  assert.equal(result.scoring_breakdown.experience_alignment.score, 100)
})

test('skill-specific duration in missingSkills does not trigger total-experience cap', () => {
  const input = candidate()
  input.years_experience = 6
  input.missingSkills = ['Kubernetes: 1 year only']
  input.fit_assessment.risks_or_gaps = []
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 4 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, false)
  assert.equal(result.scoring_breakdown.experience_alignment.safer_candidate_years, 6)
  assert.equal(result.scoring_breakdown.experience_alignment.score, 100)
})

test('skill-specific years in narrative do not override total years_experience', () => {
  const cases = [
    '1 year of React experience',
    '2 years of Python experience',
    '1.5 years of TypeScript experience',
    '3 years PostgreSQL experience',
    '2 years of Docker experience',
  ]

  for (const text of cases) {
    const input = candidate()
    input.years_experience = 5
    input.summary = `Candidate has 5 years total professional experience and ${text}.`
    input.fit_assessment.risks_or_gaps = []
    const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 3 })
    assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 5, `${text} should not be total experience`)
    assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, false, `${text} should not trigger below-minimum evidence`)
    assert.equal(result.scoring_breakdown.experience_alignment.score, 100)
  }
})

test('skill-specific months in narrative do not become total years experience', () => {
  const input = candidate()
  input.years_experience = 5
  input.summary = 'Candidate has 5 years total professional experience and 6 months of AWS experience.'
  input.fit_assessment.risks_or_gaps = []
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 3 })
  assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 5)
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, false)
  assert.equal(result.scoring_breakdown.experience_alignment.score, 100)
})

test('explicit total-experience phrases with decimal years override rounded AI years when below minimum', () => {
  const cases = [
    ['1.6 years of professional software experience', 1.6],
    ['2.8 years of relevant engineering experience', 2.8],
    ['4.1 years building production SaaS features', 4.1],
    ['2.8 years as a software engineer', 2.8],
  ]

  for (const [text, expectedYears] of cases) {
    const input = candidate()
    input.years_experience = Math.ceil(expectedYears)
    input.summary = `AI rounded the candidate up, but resume-derived evidence says ${text}.`
    input.fit_assessment.risks_or_gaps = ['Below minimum required experience based on precise resume evidence.']
    const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 5 })
    assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, expectedYears, `${text} should resolve as total experience`)
    assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
    assert.ok(result.scoring_breakdown.experience_alignment.score < 100)
  }
})

test('candidate years_experience of 2 is capped when text says 1.6 years', () => {
  const input = candidate()
  input.years_experience = 2
  input.summary = 'Candidate has 1.6 years of experience, below minimum.'
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  assert.ok(result.scoring_breakdown.experience_alignment.score <= 60)
})

test('1.6 years in summary overrides years_experience=2', () => {
  const input = candidate()
  input.years_experience = 2
  input.summary = 'Candidate has 1.6 years of experience and is 0.4 years below minimum.'
  input.fit_assessment.rationale = 'AI initially rounded this to 2 years, but the resume evidence says 1.6 years.'
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  const experience = result.scoring_breakdown.experience_alignment
  assert.equal(experience.below_min_experience_evidence_applied, true)
  assert.equal(experience.safer_candidate_years, 1.6)
  assert.ok(experience.score < 100)
  assert.ok(experience.score <= 60)
})

test('matched requirement claiming 2 years does not override below-minimum evidence', () => {
  const input = candidate()
  input.years_experience = 2
  input.fit_assessment.matched_requirements = [
    '2 years professional software development experience',
    'Java',
    'SQL',
  ]
  input.fit_assessment.risks_or_gaps = ['Resume states 1.6 years and below 2-year minimum.']
  input.summary = 'Falls short of the 2-5 year requirement.'
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2, required_max_years: 5 })
  const experience = result.scoring_breakdown.experience_alignment
  assert.equal(experience.below_min_experience_evidence_applied, true)
  assert.ok(experience.score <= 60)
  assert.notEqual(experience.score, 100)
})

test('non-experience Kubernetes shortfall gap does not trigger below-minimum experience cap', () => {
  const input = candidate()
  input.years_experience = 2.2
  input.summary = 'Candidate has 2.2 years of professional software development experience.'
  input.fit_assessment.matched_requirements = [
    '2+ years professional software development experience',
    'Java',
    'SQL',
  ]
  input.fit_assessment.missing_requirements = ['Kubernetes']
  input.fit_assessment.risks_or_gaps = ['Falls short of required Kubernetes depth']
  input.matchedSkills = ['Java', 'SQL']
  input.missingSkills = ['Kubernetes']
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  const experience = result.scoring_breakdown.experience_alignment
  assert.equal(experience.below_min_experience_evidence_applied, false)
  assert.equal(experience.experience_relevance_cap_applied, false)
  assert.equal(experience.score, 100)
})

test('non-experience architecture depth missing requirement does not trigger below-minimum experience cap', () => {
  const input = candidate()
  input.years_experience = 3
  input.summary = 'Candidate has 3 years of professional software development experience.'
  input.fit_assessment.matched_requirements = [
    '3 years professional software development experience',
    'Java',
    'SQL',
  ]
  input.fit_assessment.missing_requirements = ['short of target architecture depth']
  input.fit_assessment.risks_or_gaps = []
  input.matchedSkills = ['Java', 'SQL']
  input.missingSkills = ['architecture']
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  const experience = result.scoring_breakdown.experience_alignment
  assert.equal(experience.below_min_experience_evidence_applied, false)
  assert.equal(experience.experience_relevance_cap_applied, false)
  assert.equal(experience.score, 100)
})

test('true 2.2 years candidate is not penalized', () => {
  const input = candidate()
  input.years_experience = 2.2
  input.summary = 'Candidate has 2.2 years of professional software development experience.'
  input.fit_assessment.matched_requirements = [
    '2+ years professional software development experience',
    'Java',
    'SQL',
  ]
  input.fit_assessment.missing_requirements = ['Kubernetes']
  input.fit_assessment.risks_or_gaps = []
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2, required_max_years: 5 })
  const experience = result.scoring_breakdown.experience_alignment
  assert.equal(experience.below_min_experience_evidence_applied, false)
  assert.equal(experience.experience_relevance_cap_applied, false)
  assert.equal(experience.score, 100)
})

test('candidate years_experience of 2 is not capped without contradiction or gap signals', () => {
  const input = candidate()
  input.years_experience = 2
  input.summary = 'Candidate has 2 years of relevant experience.'
  input.fit_assessment.risks_or_gaps = []
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, false)
  assert.equal(result.scoring_breakdown.experience_alignment.score, 100)
})

test('missing requirements mentioning experience gap trigger experience cap', () => {
  const input = candidate()
  input.years_experience = 2
  input.fit_assessment.missing_requirements = ['Experience gap: below minimum 2 years for the role']
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  assert.ok(result.scoring_breakdown.experience_alignment.score <= 60)
})

test('fit assessment risks_or_gaps mentioning below minimum trigger experience cap', () => {
  const input = candidate()
  input.years_experience = 2
  input.fit_assessment.risks_or_gaps = ['Below minimum required experience; early career profile']
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  assert.ok(result.scoring_breakdown.experience_alignment.score <= 60)
})

test('AI numeric fields still do not influence deterministic score with experience cap signals', () => {
  const first = candidate()
  first.years_experience = 2
  first.summary = 'Has 1.6 years and is below required years.'
  first.score = 1
  first.matchScore = { score: 1, reason: 'below minimum experience' }
  const second = structuredClone(first)
  second.score = 100
  second.matchScore.score = 100
  assert.equal(scoreCandidateDeterministically(first, { ...jdContext(), required_min_years: 2 }).final_score, scoreCandidateDeterministically(second, { ...jdContext(), required_min_years: 2 }).final_score)
})

test('requirement and skill scoring deduplicates wording-varied matches', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['Experience with Node.js', 'Node.js experience', 'SQL']
  input.fit_assessment.missing_requirements = ['Kubernetes']
  input.matchedSkills = ['Experience with Node.js', 'Node.js experience', 'SQL']
  input.missingSkills = ['Kubernetes']
  const result = scoreCandidateDeterministically(input, jdContext())
  assert.equal(result.scoring_breakdown.requirement_match.matched_count, 2)
  assert.equal(result.scoring_breakdown.skill_alignment.matched_count, 2)
})

test('experience score caps when candidate exceeds requirement', () => {
  const input = candidate()
  input.years_experience = 20
  assert.equal(scoreCandidateDeterministically(input, jdContext()).scoring_breakdown.experience_alignment.score, 100)
})

test('risk penalty is capped', () => {
  const input = candidate()
  input.fit_assessment.risks_or_gaps = Array.from({ length: 20 }, (_, index) => `gap-${index}`)
  assert.equal(scoreCandidateDeterministically(input, jdContext()).scoring_breakdown.risk_penalty.penalty, 10)
})

test('low confidence dampens score but high confidence does not boost above base', () => {
  const low = candidate()
  low.confidence = { skills: 0, experience: 0, fit_assessment: 0 }
  const high = candidate()
  high.confidence = { skills: 1, experience: 1, fit_assessment: 1 }
  const lowResult = scoreCandidateDeterministically(low, jdContext())
  const highResult = scoreCandidateDeterministically(high, jdContext())
  assert.equal(highResult.scoring_breakdown.confidence_adjustment.multiplier, 1)
  assert.ok(lowResult.final_score < highResult.final_score)
})

test('AI numeric score fields do not affect deterministic score', () => {
  const first = candidate()
  first.score = 1
  first.matchScore = { score: 1 }
  first.fit_assessment.overall_fit_score = 1
  first.fit_assessment.skill_match_score = 1
  first.fit_assessment.experience_match_score = 1
  first.fit_assessment.education_match_score = 1
  first.fit_assessment.location_match_score = 1
  const second = structuredClone(first)
  second.score = 100
  second.matchScore.score = 100
  second.fit_assessment.overall_fit_score = 100
  second.fit_assessment.skill_match_score = 100
  second.fit_assessment.experience_match_score = 100
  second.fit_assessment.education_match_score = 100
  second.fit_assessment.location_match_score = 100
  assert.equal(scoreCandidateDeterministically(first, jdContext()).final_score, scoreCandidateDeterministically(second, jdContext()).final_score)
})

test('profile_score has only small effect', () => {
  const low = candidate()
  low.profile_score = 0
  const high = candidate()
  high.profile_score = 100
  const swing = scoreCandidateDeterministically(high, jdContext()).final_score - scoreCandidateDeterministically(low, jdContext()).final_score
  assert.ok(swing <= 5)
})

test('score band/verdict mapping is deterministic', () => {
  const result = scoreCandidateDeterministically(candidate(), jdContext())
  const repeat = scoreCandidateDeterministically(candidate(), jdContext())
  assert.equal(result.score_band, repeat.score_band)
  assert.equal(result.verdict, repeat.verdict)
})

test('No PII/raw text fields are emitted in the deterministic scoring result', () => {
  const input = candidate()
  input.name = 'Private Person'
  input.email = 'private@example.com'
  input.phone = '555-0100'
  input.filename = 'private-resume.pdf'
  input.raw_resume_text = 'raw resume content'
  const serialized = JSON.stringify(scoreCandidateDeterministically(input, jdContext()))
  for (const forbidden of ['Private Person', 'private@example.com', '555-0100', 'private-resume.pdf', 'raw resume content']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('deterministic service is only imported by guarded backend shadow paths', () => {
  for (const path of ['backend/src/routes/results.js', 'backend/src/routes/candidates.js']) {
    const source = readFileSync(resolve(path), 'utf8')
    assert.equal(source.includes('deterministicJdFitScoringService'), false, `${path} must not import the scorer`)
    assert.equal(source.includes('scoreCandidateDeterministically'), false, `${path} must not call the scorer`)
  }

  const parseJobSource = readFileSync(resolve('backend/src/jobs/parseResumeJob.js'), 'utf8')
  assert.equal(parseJobSource.includes('DETERMINISTIC_JD_FIT_SHADOW_ENABLED'), true)
  assert.equal(parseJobSource.includes('[DeterministicJdFit] shadow diagnostic'), true)
})

test('hasContext false with source none returns profile_only when profile_score exists', () => {
  const result = scoreCandidateDeterministically(candidate(), { hasContext: false, source: 'none' })
  assert.equal(result.scoring_mode, 'profile_only')
  assert.notEqual(result.final_score, null)
})

test('hasContext false with source none returns insufficient_evidence when profile_score is missing', () => {
  const input = candidate()
  delete input.profile_score
  const result = scoreCandidateDeterministically(input, { hasContext: false, source: 'none' })
  assert.equal(result.scoring_mode, 'insufficient_evidence')
  assert.equal(result.final_score, null)
})

test('source none alone must not cause jd_fit', () => {
  const result = scoreCandidateDeterministically(candidate(), { source: 'none' })
  assert.equal(result.scoring_mode, 'profile_only')
})

test('hasContext true with minimal JD fields allows jd_fit', () => {
  const result = scoreCandidateDeterministically(candidate(), { hasContext: true, source: 'none' })
  assert.equal(result.scoring_mode, 'jd_fit')
})

test('experienceYears is recognized for required years', () => {
  const numberResult = scoreCandidateDeterministically(candidate(), { title: 'Engineer', experienceYears: 5 })
  assert.equal(numberResult.scoring_breakdown.experience_alignment.required_min_years, 5)
  assert.equal(numberResult.scoring_breakdown.experience_alignment.required_max_years, null)

  const objectResult = scoreCandidateDeterministically(candidate(), { title: 'Engineer', experienceYears: { min: 3, max: 7 } })
  assert.equal(objectResult.scoring_breakdown.experience_alignment.required_min_years, 3)
  assert.equal(objectResult.scoring_breakdown.experience_alignment.required_max_years, 7)
})

const priyaLikeCandidate = () => ({
  fit_assessment: {
    matched_requirements: ['3 years experience', 'Java basics', 'SQL exposure'],
    missing_requirements: [
      'Not SDE experience; QA-focused background',
      'No production feature ownership evidence',
      'No backend ownership evidence',
      'No system design or architecture evidence',
    ],
    risks_or_gaps: ['Role transition risk from QA to SDE', 'No deployment ownership evidence'],
  },
  matchedSkills: ['Java', 'SQL', 'Testing'],
  missingSkills: ['Backend services', 'Cloud', 'Data structures', 'Algorithms'],
  skills_flat: ['Java', 'SQL', 'Manual testing', 'Automation testing'],
  top_skills: ['QA', 'Testing'],
  years_experience: 3,
  location: 'Kochi, India',
  confidence: { skills: 0.9, experience: 0.98, fit_assessment: 0.98 },
  profile_score: 80,
})

const sdeJdContext = () => ({
  title: 'Software Development Engineer',
  location: 'Bengaluru/Hyderabad/Pune/Remote Hybrid',
  required_min_years: 3,
})

describe('format stability regression matrix', () => {
  const context = () => ({ ...sdeJdContext(), required_min_years: 2, required_max_years: 5 })
  const scoreSpread = (results) => Math.max(...results.map((result) => result.final_score)) - Math.min(...results.map((result) => result.final_score))

  const aishaBase = () => ({
    skills_flat: ['TypeScript', 'Node.js', 'Express', 'NestJS', 'React', 'Next.js', 'PostgreSQL', 'Redis', 'Docker', 'AWS', 'Jest', 'GitHub Actions', 'RBAC', 'JWT'],
    skills_structured: {
      backend: ['Node.js production APIs', 'Express services', 'NestJS services', 'PostgreSQL'],
      frontend: ['React', 'Next.js'],
      platform: ['Redis caching', 'Docker deployments', 'AWS deployments'],
      quality: ['Jest unit tests', 'CI/CD with GitHub Actions'],
      security: ['RBAC permissions', 'JWT authentication'],
    },
    experience: ['4.1 years professional software experience building production Node.js APIs, PostgreSQL, Redis queues, RBAC/JWT auth, CI/CD, Docker, AWS, and system design reviews.'],
    projects: ['Recruiting workflow with React, Next.js, Node.js REST APIs, PostgreSQL, Redis background jobs, and secure RBAC.'],
    years_experience: 4.1,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 85,
  })

  const nehaBase = () => ({
    skills_flat: ['React', 'Next.js', 'TypeScript', 'Node.js', 'Jest', 'REST APIs'],
    skills_structured: {
      frontend: ['React production UI', 'Next.js pages', 'TypeScript'],
      backend: ['Node.js API support'],
      quality: ['Jest component tests'],
    },
    experience: ['2.8 years professional software experience, strongest in React and Next.js with some Node.js API work.'],
    years_experience: 2.8,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 75,
  })

  const vikramBase = () => ({
    skills_flat: ['Java', 'SQL', 'React basics', 'Flask basics', 'Express basics', 'Docker basics'],
    skills_structured: {
      languages: ['Java', 'SQL'],
      frameworks: ['React basics', 'Flask basics', 'Express basics'],
      platforms: ['Docker basics', 'Render deployment exposure', 'Railway deployment exposure'],
    },
    experience: ['Resume-derived total experience is 1.6 years of professional software experience.'],
    projects: ['Toy demo app with Docker basics and manual deployment exposure.'],
    years_experience: 1.6,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  })

  const variants = {
    aisha: [
      { matched: ['TypeScript/Node.js APIs', 'PostgreSQL', 'React/Next.js', 'Redis queues', 'RBAC/JWT', 'testing CI/CD', '4 years experience'], missing: ['advanced algorithms', 'cloud breadth'], risks: ['Limited big-tech scale evidence'], aiScore: 92 },
      { matched: ['Node.js REST APIs', 'PostgreSQL', 'React/Next.js', 'Redis queues', 'RBAC/JWT', 'AWS/Docker', 'testing CI/CD', 'system design', '4 years experience'], missing: ['advanced algorithms'], risks: [], aiScore: 95 },
      { matched: ['Node APIs', 'SQL', 'React', 'Redis caching', 'RBAC/JWT', 'CI/CD testing', 'AWS deployments', '4 years professional experience'], missing: ['advanced algorithms'], risks: ['Narrative omits some structured production details'], aiScore: 88 },
    ],
    neha: [
      { matched: ['React/Next.js', 'TypeScript frontend', 'Jest testing', 'some Node APIs'], missing: ['backend ownership depth', 'cloud/platform depth', 'system design', 'queues/background jobs', 'auth/RBAC'], risks: ['Frontend-leaning profile'], aiScore: 61 },
      { matched: ['React production UI', 'Next.js', 'TypeScript', 'REST API support'], missing: ['distributed systems', 'AWS/GCP/Kubernetes', 'backend service ownership', 'async queues', 'auth/RBAC'], risks: ['Limited backend depth', 'Cloud and async depth not shown'], aiScore: 59 },
      { matched: ['Strong frontend engineering', '2.8 years experience', 'Node.js exposure'], missing: ['cloud production ownership', 'system design', 'RBAC/auth depth', 'background jobs'], risks: ['Frontend strength should not imply broad SDE depth'], aiScore: 64 },
    ],
    vikram: [
      { years_experience: 1.6, summary: 'Has 1.6 years experience and falls below the 2-5 year requirement.', matched: ['Java', 'SQL', 'backend APIs'], missing: ['minimum 2 years experience', 'system design', 'cloud', 'testing CI/CD', 'auth/RBAC', 'queues/background jobs'], risks: ['Experience gap: 1.6 years is below minimum for 2-5 years', 'No system design evidence', 'No cloud evidence', 'No auth/RBAC evidence', 'No queues/background jobs evidence'], aiScore: 49 },
      { years_experience: 2, summary: 'AI wording says meets 2-year minimum, but resume-derived evidence says 1.6 years professional software experience.', matched: ['2 years professional software development experience', 'Java', 'SQL', 'React basics'], missing: ['system design depth', 'AWS/GCP/Kubernetes cloud', 'integration testing', 'auth/RBAC', 'queues/background jobs'], risks: ['Falls short of the 2-5 years target by 0.4 years', 'No system design evidence', 'No cloud ownership evidence', 'No auth/RBAC evidence', 'No queues/background jobs evidence'], aiScore: 57 },
      { years_experience: 2, summary: 'High-potential junior; matched requirements mention 2 years professional experience.', matched: ['2 years professional experience', 'Java', 'SQL', 'Flask/Express basics'], missing: ['production TypeScript depth', 'system design', 'cloud platform experience', 'CI/CD', 'auth/RBAC', 'async queues'], risks: ['Junior profile; experience gap below required years', 'No system design evidence', 'No cloud evidence', 'No CI/CD evidence', 'No async queues evidence'], aiScore: 54 },
    ],
  }

  const makeCandidate = (base, variant) => ({
    ...base(),
    ...('years_experience' in variant ? { years_experience: variant.years_experience } : {}),
    ...('summary' in variant ? { summary: variant.summary } : {}),
    score: variant.aiScore,
    matchScore: { score: variant.aiScore, reason: variant.summary ?? 'Format-specific AI wording.' },
    fit_assessment: {
      overall_fit_score: variant.aiScore,
      rationale: variant.summary ?? 'Format-specific AI wording.',
      matched_requirements: variant.matched,
      missing_requirements: variant.missing,
      risks_or_gaps: variant.risks,
    },
    matchedSkills: variant.matched,
    missingSkills: variant.missing,
  })

  test('same candidate/JD/content stays stable across DOC/PDF/DOCX-like wording', () => {
    const aisha = variants.aisha.map((variant) => scoreCandidateDeterministically(makeCandidate(aishaBase, variant), context()))
    const neha = variants.neha.map((variant) => scoreCandidateDeterministically(makeCandidate(nehaBase, variant), context()))
    const vikram = variants.vikram.map((variant) => scoreCandidateDeterministically(makeCandidate(vikramBase, variant), context()))

    assert.ok(scoreSpread(aisha) <= 5, `Aisha spread ${scoreSpread(aisha)} from ${aisha.map((result) => result.final_score).join(', ')}`)
    assert.ok(scoreSpread(neha) <= 5, `Neha spread ${scoreSpread(neha)} from ${neha.map((result) => result.final_score).join(', ')}`)
    assert.ok(scoreSpread(vikram) <= 5, `Vikram spread ${scoreSpread(vikram)} from ${vikram.map((result) => result.final_score).join(', ')}`)

    for (const result of aisha) {
      assert.ok(result.final_score >= 70)
      assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 4.1)
    }
    for (const result of neha) {
      assert.ok(result.final_score >= 50 && result.final_score < 70)
      assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 2.8)
    }
    for (const result of vikram) {
      assert.ok(result.final_score < 57, `Vikram final score ${result.final_score} should stay below the moderate-high band`)
      assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 1.6)
      assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
    }

    assert.ok(Math.min(...aisha.map((result) => result.final_score)) > Math.max(...neha.map((result) => result.final_score)))
    assert.ok(
      Math.min(...neha.map((result) => result.final_score)) > Math.max(...vikram.map((result) => result.final_score)),
      `Neha scores ${neha.map((result) => result.final_score).join(', ')} should rank above Vikram scores ${vikram.map((result) => result.final_score).join(', ')}`,
    )
  })
})

test('QA-focused candidate with missing SDE/backend ownership evidence does not receive max experience score', () => {
  const result = scoreCandidateDeterministically(priyaLikeCandidate(), sdeJdContext())
  const experience = result.scoring_breakdown.experience_alignment
  assert.equal(experience.experience_relevance_cap_applied, true)
  assert.ok(experience.role_gap_signal_count >= 4)
  assert.ok(experience.score >= 45 && experience.score <= 65)
  assert.notEqual(experience.score, 100)
  assert.ok(result.final_score >= 40 && result.final_score < 50)
})

test('candidate with true SDE/backend evidence and enough years keeps high experience score', () => {
  const input = candidate()
  input.years_experience = 5
  input.fit_assessment.matched_requirements = ['SDE experience', 'Backend ownership', 'Production feature delivery', 'System design']
  input.fit_assessment.missing_requirements = ['Kubernetes']
  input.fit_assessment.risks_or_gaps = []
  input.matchedSkills = ['Node.js', 'Backend services', 'System design', 'SQL']
  input.missingSkills = ['Kubernetes']
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 3 })
  assert.equal(result.scoring_breakdown.experience_alignment.score, 100)
  assert.equal(result.scoring_breakdown.experience_alignment.experience_relevance_cap_applied, false)
  assert.ok(result.final_score >= 70)
})

test('Kochi vs Bengaluru/Hyderabad/Pune/Remote Hybrid scores below prior broad remote fallback', () => {
  const result = scoreCandidateDeterministically(priyaLikeCandidate(), sdeJdContext())
  assert.ok(result.scoring_breakdown.location_alignment.score >= 35)
  assert.ok(result.scoring_breakdown.location_alignment.score <= 45)
  assert.notEqual(result.scoring_breakdown.location_alignment.score, 65)
})

test('Remote candidate scores higher than non-listed city for Remote Hybrid JD', () => {
  const kochi = scoreCandidateDeterministically(priyaLikeCandidate(), sdeJdContext())
  const remote = priyaLikeCandidate()
  remote.location = 'Remote, India'
  const remoteResult = scoreCandidateDeterministically(remote, sdeJdContext())
  assert.ok(remoteResult.scoring_breakdown.location_alignment.score > kochi.scoring_breakdown.location_alignment.score)
})

test('listed city tokens in slash-separated Remote Hybrid JD score high', () => {
  const bengaluru = candidate()
  bengaluru.location = 'Bengaluru, India'
  assert.equal(scoreCandidateDeterministically(bengaluru, sdeJdContext()).scoring_breakdown.location_alignment.score, 95)

  const hyderabad = candidate()
  hyderabad.location = 'Hyderabad, Telangana'
  assert.equal(scoreCandidateDeterministically(hyderabad, sdeJdContext()).scoring_breakdown.location_alignment.score, 95)

  const pune = candidate()
  pune.location = 'Pune'
  assert.equal(scoreCandidateDeterministically(pune, sdeJdContext()).scoring_breakdown.location_alignment.score, 95)
})

test('exact location match scores high and missing location remains neutral', () => {
  const exact = candidate()
  exact.location = 'Austin, TX'
  assert.equal(scoreCandidateDeterministically(exact, jdContext()).scoring_breakdown.location_alignment.score, 95)

  const missingCandidateLocation = candidate()
  delete missingCandidateLocation.location
  assert.equal(scoreCandidateDeterministically(missingCandidateLocation, sdeJdContext()).scoring_breakdown.location_alignment.score, 50)

  assert.equal(scoreCandidateDeterministically(candidate(), { title: 'Engineer' }).scoring_breakdown.location_alignment.score, 50)
})

test('same semantic requirement evidence with duplicated wording produces similar requirement scores', () => {
  const first = candidate()
  first.fit_assessment.matched_requirements = ['Node.js backend APIs', 'SQL databases', 'AWS cloud']
  first.fit_assessment.missing_requirements = ['system design', 'unit testing', 'authorization/RBAC']

  const second = candidate()
  second.fit_assessment.matched_requirements = [
    'Backend API services with Node.js',
    'NodeJS server-side APIs',
    'SQL database experience',
    'PostgreSQL databases',
    'Cloud platform exposure - AWS',
  ]
  second.fit_assessment.missing_requirements = [
    'Distributed systems / scalability design missing',
    'No architecture or system design evidence',
    'Missing unit and integration testing',
    'CI/CD testing pipeline not shown',
    'No secure API authorization evidence',
    'RBAC not demonstrated',
  ]

  const firstResult = scoreCandidateDeterministically(first, jdContext())
  const secondResult = scoreCandidateDeterministically(second, jdContext())
  assert.ok(Math.abs(firstResult.scoring_breakdown.requirement_match.score - secondResult.scoring_breakdown.requirement_match.score) <= 5)
  assert.equal(secondResult.scoring_breakdown.requirement_match.normalized_requirement_missing_count, 3)
  assert.equal(secondResult.scoring_breakdown.requirement_match.requirement_variance_smoothing_applied, true)
})

test('duplicate missing requirements do not over-penalize requirement score', () => {
  const baseline = candidate()
  baseline.fit_assessment.matched_requirements = ['Java', 'SQL', 'Backend APIs']
  baseline.fit_assessment.missing_requirements = ['cloud', 'system design']

  const duplicated = structuredClone(baseline)
  duplicated.fit_assessment.missing_requirements = [
    'cloud',
    'AWS experience',
    'Azure or GCP cloud platform',
    'system design',
    'distributed systems architecture',
    'scalability design',
  ]

  const baselineResult = scoreCandidateDeterministically(baseline, jdContext())
  const duplicatedResult = scoreCandidateDeterministically(duplicated, jdContext())
  assert.equal(duplicatedResult.scoring_breakdown.requirement_match.normalized_requirement_missing_count, 2)
  assert.equal(duplicatedResult.scoring_breakdown.requirement_match.score, baselineResult.scoring_breakdown.requirement_match.score)
})

test('missing core SDE concepts still penalize requirement score', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['Java', 'SQL']
  input.fit_assessment.missing_requirements = ['cloud/AWS', 'system design', 'testing/CI/CD', 'auth/RBAC', 'async queues']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.ok(result.scoring_breakdown.requirement_match.score <= 40)
  assert.ok(result.final_score < 55)
})

test('Vikram-like DOC/DOCX/PDF requirement wording fixtures stay within five final-score points', () => {
  const context = { ...sdeJdContext(), required_min_years: 2, required_max_years: 5 }
  const vikramLike = ({ matched, missing, matchedSkills = matched, missingSkills = missing, aiScore = 50 }) => ({
    summary: 'Candidate has 1.6 years experience and is below minimum for the role.',
    recommendation: 'Low-to-moderate fit due to experience and production SDE gaps.',
    score: aiScore,
    matchScore: { score: aiScore, reason: 'Below 2-5 years required experience.', breakdown: { experience: 'has 1.6 years' } },
    fit_assessment: {
      overall_fit_score: aiScore,
      rationale: 'Early career backend profile.',
      matched_requirements: matched,
      missing_requirements: missing,
      risks_or_gaps: ['Experience gap: 1.6 years is below minimum for 2-5 years', 'Junior profile for SDE ownership'],
    },
    matchedSkills,
    missingSkills,
    skills_flat: ['Java', 'SQL'],
    top_skills: ['Backend services'],
    years_experience: 1.6,
    location: 'Pune',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  })

  const results = [
    scoreCandidateDeterministically(vikramLike({
      matched: ['Java', 'SQL', 'Backend APIs'],
      missing: ['2-5 years production experience', 'system design', 'AWS/cloud', 'unit testing', 'auth/RBAC', 'async queues'],
    }), context),
    scoreCandidateDeterministically(vikramLike({
      matched: ['Java', 'SQL', 'Backend API services'],
      missing: ['professional experience gap', 'distributed systems/scalability', 'cloud platform experience', 'CI/CD and integration tests', 'authorization secure API', 'background jobs/caching', 'AWS', 'Azure'],
      aiScore: 85,
    }), context),
    scoreCandidateDeterministically(vikramLike({
      matched: ['Java', 'SQL'],
      missing: ['minimum 2 years experience', 'architecture', 'Kubernetes', 'testing', 'RBAC', 'queues'],
      aiScore: 15,
    }), context),
  ]

  const finalScores = results.map((result) => result.final_score)
  assert.ok(Math.max(...finalScores) - Math.min(...finalScores) <= 5)
  for (const result of results) {
    assert.ok(result.final_score >= 45 && result.final_score <= 53)
    assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  }
})

test('strong SDE candidate with backend cloud testing and system design scores meaningfully higher', () => {
  const weak = candidate()
  weak.years_experience = 1.6
  weak.summary = 'Candidate has 1.6 years experience and is below minimum.'
  weak.fit_assessment.matched_requirements = ['Java', 'SQL']
  weak.fit_assessment.missing_requirements = ['cloud', 'system design', 'testing', 'auth', 'async queues']
  weak.fit_assessment.risks_or_gaps = ['Experience gap: 1.6 years is below minimum for 2 years']
  weak.matchedSkills = ['Java', 'SQL']
  weak.missingSkills = ['cloud', 'system design', 'testing', 'auth', 'async queues']

  const strong = candidate()
  strong.years_experience = 6
  strong.fit_assessment.matched_requirements = ['Node.js backend APIs', 'SQL databases', 'AWS cloud', 'Kubernetes', 'unit/integration testing', 'system design', 'async queues', 'auth/RBAC']
  strong.fit_assessment.missing_requirements = []
  strong.fit_assessment.risks_or_gaps = []
  strong.matchedSkills = ['Node.js', 'SQL', 'AWS', 'Kubernetes', 'Testing', 'System design', 'Queues', 'RBAC']
  strong.missingSkills = []

  const weakResult = scoreCandidateDeterministically(weak, { ...jdContext(), required_min_years: 2 })
  const strongResult = scoreCandidateDeterministically(strong, { ...jdContext(), required_min_years: 2 })
  assert.ok(strongResult.final_score - weakResult.final_score >= 20)
  assert.ok(strongResult.final_score >= 75)
})

test('Aisha-like DOC/PDF/DOCX evidence drift stays stable from structured resume evidence', () => {
  const context = { ...sdeJdContext(), required_min_years: 4, required_max_years: 7 }
  const structuredResumeEvidence = {
    skills_flat: [
      'TypeScript',
      'Node.js',
      'Express',
      'NestJS',
      'React',
      'Next.js',
      'PostgreSQL',
      'Redis',
      'Docker',
      'AWS',
      'Jest',
      'GitHub Actions',
      'RBAC',
      'JWT',
    ],
    skills_structured: {
      backend: ['Node.js', 'Express APIs', 'NestJS services', 'PostgreSQL'],
      frontend: ['React', 'Next.js'],
      platform: ['Redis caching', 'Docker deployments', 'AWS'],
      quality: ['Jest unit tests', 'CI/CD with GitHub Actions'],
      security: ['RBAC permissions', 'JWT authentication'],
    },
    experience: [
      {
        title: 'Software Engineer',
        bullets: [
          'Built production backend APIs with Node.js, Express, NestJS, and PostgreSQL.',
          'Implemented RBAC, JWT authentication, Redis caching, async workers, and background jobs.',
          'Owned incident RCA, monitoring improvements, Jest tests, CI/CD, Docker, and AWS deployments.',
          'Contributed scalable service architecture and system design reviews.',
        ],
      },
    ],
    projects: [
      'Production recruiting workflow using React, Next.js, Node.js APIs, PostgreSQL, Redis queues, and secure RBAC.',
    ],
    achievements: ['Reduced API latency with caching and background job processing; improved deployment reliability.'],
    years_experience: 4.1,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 85,
  }
  const aishaLike = ({ matched, missing, matchedSkills = matched, missingSkills = missing, risks = [], aiScore }) => ({
    ...structuredClone(structuredResumeEvidence),
    score: aiScore,
    matchScore: { score: aiScore, reason: 'AI generated format-specific rationale.' },
    fit_assessment: {
      overall_fit_score: aiScore,
      rationale: 'AI generated format-specific fit assessment.',
      matched_requirements: matched,
      missing_requirements: missing,
      risks_or_gaps: risks,
    },
    matchedSkills,
    missingSkills,
  })

  const docx = scoreCandidateDeterministically(aishaLike({
    aiScore: 88,
    matched: ['TypeScript/Node.js', 'React', 'PostgreSQL', '4 years experience'],
    missing: ['system design depth', 'algorithms', 'cloud breadth', 'auth/RBAC depth', 'async/background jobs', 'testing CI/CD'],
    risks: ['May lack FAANG-scale distributed systems depth', 'Cloud breadth not fully shown'],
  }), context)
  const pdf = scoreCandidateDeterministically(aishaLike({
    aiScore: 88,
    matched: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis caching', 'RBAC/JWT API security', 'async/background jobs', 'Bengaluru match', 'testing CI/CD', 'production monitoring and incident RCA'],
    missing: ['advanced algorithms'],
    risks: ['Limited big-tech scale evidence'],
  }), context)
  const doc = scoreCandidateDeterministically(aishaLike({
    aiScore: 82,
    matched: ['Node APIs', 'React', 'SQL', '4 years professional experience'],
    missing: ['no FAANG-scale distributed systems', 'system design', 'cloud breadth', 'algorithms', 'auth/RBAC depth', 'async/background jobs', 'testing CI/CD'],
    risks: ['Missing system design repeated in narrative', 'No broad cloud platform ownership'],
  }), context)

  for (const result of [docx, pdf, doc]) {
    const breakdown = result.scoring_breakdown
    assert.ok(result.final_score >= 70)
    assert.equal(breakdown.experience_alignment.resolved_experience_years, 4.1)
    assert.equal(breakdown.experience_alignment.experience_resolution_source, 'candidate_years')
    assert.equal(breakdown.experience_alignment.score, 100)
    assert.ok(breakdown.requirement_match.structured_positive_bucket_count > 0)
    assert.ok(breakdown.skill_alignment.structured_positive_bucket_count > 0)
  }

  const scores = [docx.final_score, pdf.final_score, doc.final_score]
  assert.ok(Math.max(...scores) - Math.min(...scores) <= 5)
})

test('Aisha-like same-format richer narrative cannot jump beyond five points without new JD buckets', () => {
  const context = { ...sdeJdContext(), required_min_years: 4, required_max_years: 7 }
  const base = {
    skills_flat: ['TypeScript', 'Node.js', 'Express', 'NestJS', 'React', 'PostgreSQL', 'Redis', 'Docker', 'AWS', 'Jest', 'RBAC', 'JWT'],
    skills_structured: {
      backend: ['Node.js production APIs', 'NestJS services', 'PostgreSQL'],
      platform: ['Redis caching', 'Docker deployments', 'AWS deployments'],
      quality: ['Jest tests', 'CI/CD pipeline ownership'],
      security: ['RBAC permissions', 'JWT authentication'],
    },
    experience: ['Built production Node.js APIs, Redis caching, async background jobs, RBAC/JWT auth, Jest tests, CI/CD, Docker and AWS deployments.'],
    years_experience: 4.1,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 85,
  }
  const previousDocx = scoreCandidateDeterministically({
    ...structuredClone(base),
    fit_assessment: {
      matched_requirements: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis caching', 'RBAC/JWT security', 'async/background jobs', 'testing CI/CD', 'Docker/AWS deployments', '4 years experience'],
      missing_requirements: ['algorithms'],
      risks_or_gaps: [],
    },
    matchedSkills: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis caching', 'RBAC/JWT security', 'async/background jobs', 'testing CI/CD', 'Docker/AWS deployments', '4 years experience'],
    missingSkills: ['algorithms'],
  }, context)
  const richerMixedDocx = scoreCandidateDeterministically({
    ...structuredClone(base),
    fit_assessment: {
      matched_requirements: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis caching', 'RBAC/JWT security', 'async/background jobs', 'testing CI/CD', 'Docker/AWS deployments', 'scalable system architecture', 'AWS/GCP cloud platform production depth'],
      missing_requirements: ['system design depth', 'algorithms', 'cloud breadth'],
      risks_or_gaps: ['System design and scale depth remains a calibration gap', 'Cloud breadth not fully shown'],
    },
    matchedSkills: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis caching', 'RBAC/JWT security', 'async/background jobs', 'testing CI/CD', 'Docker/AWS deployments', 'scalable system architecture', 'AWS/GCP cloud platform production depth'],
    missingSkills: ['algorithms'],
  }, context)

  assert.ok(previousDocx.final_score >= 87 && previousDocx.final_score <= 92)
  assert.ok(richerMixedDocx.final_score >= 75 && richerMixedDocx.final_score <= 92)
  assert.ok(richerMixedDocx.final_score - previousDocx.final_score <= 5)
})

test('structured positive evidence covers repeated narrative missing buckets without raw text diagnostics', () => {
  const input = candidate()
  input.years_experience = 5
  input.skills_flat = ['Node.js', 'PostgreSQL', 'Redis', 'JWT', 'RBAC', 'Jest', 'GitHub Actions', 'AWS']
  input.experience = ['Built backend APIs with async Redis queues, secure JWT/RBAC, Jest tests, CI/CD, AWS deployments, and system design ownership.']
  input.fit_assessment.matched_requirements = ['Node.js APIs', 'SQL']
  input.fit_assessment.missing_requirements = [
    'No system design evidence',
    'Missing architecture depth',
    'No async/background jobs',
    'Missing Redis caching',
    'No RBAC/JWT security',
    'Missing CI/CD testing',
  ]
  input.fit_assessment.risks_or_gaps = ['No system design evidence', 'No system design evidence']
  input.matchedSkills = ['Node.js', 'SQL']
  input.missingSkills = input.fit_assessment.missing_requirements

  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 4 })
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.system_design, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.async_background, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.auth_security, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.testing_ci, 1)
  assert.ok(result.scoring_breakdown.risk_penalty.penalty <= 2)
  assert.equal(JSON.stringify(result).includes(input.experience[0]), false)
})

test('Vikram-like rich structured basics do not cancel production depth gaps or inflate final score', () => {
  const input = {
    summary: 'Early-career candidate with mostly basic exposure.',
    fit_assessment: {
      matched_requirements: ['React UI exposure', 'Flask/Express basics'],
      missing_requirements: [
        'TypeScript production depth',
        'AWS/GCP/Kubernetes production cloud experience',
        'integration testing / CI/CD',
        'production debugging',
        'queues/background jobs',
      ],
      risks_or_gaps: [
        'Experience gap: 1.6 years is below minimum for 2-5 years',
        'No production TypeScript depth',
        'No AWS/GCP/Kubernetes production cloud evidence',
        'No integration testing or CI/CD evidence',
        'No queues/background jobs evidence',
      ],
    },
    matchedSkills: ['React', 'Flask basics', 'Express basics'],
    missingSkills: ['TypeScript production depth', 'AWS/GCP/Kubernetes', 'integration testing', 'CI/CD', 'queues/background jobs'],
    skills_flat: ['TypeScript basics', 'Docker basics', 'Render', 'Railway', 'Pytest basics', 'React', 'Flask', 'Express'],
    skills_structured: {
      languages: ['TypeScript basics'],
      platforms: ['Docker basics', 'Render deployment exposure', 'Railway deployment exposure'],
      testing: ['Pytest basics', 'manual testing'],
      frameworks: ['React', 'Flask basics', 'Express basics'],
    },
    projects: ['Toy demo app deployed to Render/Railway with Docker basics and manual Pytest checks.'],
    years_experience: 1.6,
    location: 'Remote, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  }

  const result = scoreCandidateDeterministically(input, { ...sdeJdContext(), required_min_years: 2, required_max_years: 5 })
  const requirementBuckets = result.scoring_breakdown.requirement_match.requirement_bucket_scores
  const skillBuckets = result.scoring_breakdown.skill_alignment.requirement_bucket_scores

  assert.equal(requirementBuckets.typescript_javascript_node, 0)
  assert.equal(requirementBuckets.cloud_platforms, 0)
  assert.equal(requirementBuckets.testing_ci, 0)
  assert.equal(requirementBuckets.async_background, 0)
  assert.equal(skillBuckets.typescript_javascript_node, 0)
  assert.equal(skillBuckets.cloud_platforms, 0)
  assert.equal(skillBuckets.testing_ci, 0)
  assert.equal(skillBuckets.async_background, 0)
  assert.equal(result.scoring_breakdown.experience_alignment.resolved_experience_years, 1.6)
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  assert.ok(result.final_score < 55)
})

test('Vikram-like high-potential junior wording and basics remain below Neha-like moderate fit', () => {
  const context = { ...sdeJdContext(), required_min_years: 2, required_max_years: 5 }
  const vikram = scoreCandidateDeterministically({
    summary: 'High-potential junior with 1.6 years experience and basics across a modern stack.',
    recommendation: 'Could grow with mentoring, but below the role minimum and missing production depth.',
    fit_assessment: {
      matched_requirements: ['React UI exposure', 'Flask/Express basics', 'location match'],
      missing_requirements: [
        'production TypeScript depth',
        'AWS/GCP/Kubernetes production cloud experience',
        'integration testing / CI/CD',
        'auth/RBAC',
        'queues/background jobs',
        'system design',
      ],
      risks_or_gaps: [
        'Experience gap: 1.6 years is below minimum for 2-5 years',
        'No production TypeScript depth',
        'No AWS/GCP/Kubernetes production cloud evidence',
        'No integration testing or CI/CD evidence',
        'No auth/RBAC evidence',
        'No queues/background jobs evidence',
        'No system design evidence',
      ],
    },
    matchedSkills: ['React', 'Flask basics', 'Express basics', 'TypeScript basics', 'Docker basics', 'Pytest basics'],
    missingSkills: ['TypeScript production depth', 'AWS/GCP/Kubernetes', 'integration testing', 'auth/RBAC', 'queues/background jobs', 'system design'],
    skills_flat: ['TypeScript basics', 'Docker basics', 'Render', 'Railway', 'Pytest basics', 'React', 'Flask', 'Express'],
    skills_structured: {
      languages: ['TypeScript basics'],
      platforms: ['Docker basics', 'Render deployment exposure', 'Railway deployment exposure'],
      testing: ['Pytest basics', 'manual testing'],
      frameworks: ['React', 'Flask basics', 'Express basics'],
    },
    projects: ['Toy demo app deployed to Render/Railway with Docker basics and manual Pytest checks.'],
    years_experience: 1.6,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  }, context)
  const nehaModerate = scoreCandidateDeterministically({
    fit_assessment: {
      matched_requirements: ['React/Next.js', 'TypeScript frontend', 'some Node.js APIs', 'testing'],
      missing_requirements: ['backend ownership depth', 'cloud/platform depth', 'system design', 'queues/background jobs'],
      risks_or_gaps: ['Frontend-leaning profile with limited backend ownership'],
    },
    matchedSkills: ['React/Next.js', 'TypeScript frontend', 'Node.js APIs', 'testing'],
    missingSkills: ['backend ownership depth', 'cloud/platform depth', 'system design', 'queues/background jobs'],
    skills_flat: ['React', 'Next.js', 'TypeScript', 'Node.js', 'Jest'],
    years_experience: 4,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 75,
  }, context)

  assert.ok(vikram.final_score < 50)
  assert.ok(vikram.final_score < nehaModerate.final_score)
  assert.ok(nehaModerate.final_score >= 53 && nehaModerate.final_score <= 65)
})

test('TypeScript basics in structured fields does not cancel TypeScript production depth', () => {
  const input = candidate()
  input.skills_structured = { languages: ['TypeScript basics'] }
  input.projects = ['Demo React app with TypeScript basics.']
  input.fit_assessment.matched_requirements = ['React']
  input.fit_assessment.missing_requirements = ['TypeScript production depth', 'Node.js production depth']
  input.matchedSkills = ['React']
  input.missingSkills = input.fit_assessment.missing_requirements

  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.typescript_javascript_node, 0)
  assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores.typescript_javascript_node, 0)
})

test('Docker/Render/Railway basics in structured fields do not cancel AWS/GCP/Kubernetes production cloud', () => {
  const input = candidate()
  input.skills_structured = { platforms: ['Docker basics', 'Render exposure', 'Railway exposure'] }
  input.projects = ['Toy demo deployed to Render/Railway using Docker basics.']
  input.fit_assessment.matched_requirements = ['Backend API']
  input.fit_assessment.missing_requirements = ['AWS/GCP/Kubernetes production cloud experience']
  input.matchedSkills = ['Backend API']
  input.missingSkills = input.fit_assessment.missing_requirements

  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.cloud_platforms, 0)
  assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores.cloud_platforms, 0)
})

test('Pytest basics/manual testing in structured fields do not cancel integration testing or CI/CD', () => {
  const input = candidate()
  input.skills_structured = { testing: ['Pytest basics', 'manual testing'] }
  input.projects = ['Demo app with Pytest basics and manual testing only.']
  input.fit_assessment.matched_requirements = ['Backend API']
  input.fit_assessment.missing_requirements = ['integration testing', 'CI/CD test pipelines']
  input.matchedSkills = ['Backend API']
  input.missingSkills = input.fit_assessment.missing_requirements

  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.testing_ci, 0)
  assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores.testing_ci, 0)
})

test('flat skills do not cancel production depth gaps when rich evidence lacks ownership depth', () => {
  const cases = [
    {
      skill: ['AWS'],
      missing: 'AWS/GCP/Kubernetes production cloud experience',
      bucket: 'cloud_platforms',
    },
    {
      skill: ['Kubernetes'],
      missing: 'production Kubernetes infrastructure ownership',
      bucket: 'cloud_platforms',
    },
    {
      skill: ['RBAC', 'JWT'],
      missing: 'secure auth/RBAC implementation depth',
      bucket: 'auth_security',
    },
    {
      skill: ['Redis'],
      missing: 'production queues/caching ownership',
      bucket: 'async_background',
    },
    {
      skill: ['GitHub Actions'],
      missing: 'CI/CD pipeline ownership',
      bucket: 'testing_ci',
    },
  ]

  for (const { skill, missing, bucket } of cases) {
    const input = candidate()
    input.skills_flat = skill
    input.top_skills = skill
    input.skills_structured = { tools: skill }
    input.projects = ['Internal demo project with listed tools only.']
    input.fit_assessment.matched_requirements = ['Backend API']
    input.fit_assessment.missing_requirements = [missing]
    input.matchedSkills = ['Backend API']
    input.missingSkills = [missing]

    const result = scoreCandidateDeterministically(input, sdeJdContext())
    assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores[bucket], 0, `${skill.join('/')} should not cover ${bucket}`)
    assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores[bucket], 0, `${skill.join('/')} should not cover skill ${bucket}`)
  }
})

test('rich implementation and ownership evidence can cover auth and cloud depth gaps', () => {
  const input = candidate()
  input.skills_flat = ['AWS', 'Kubernetes', 'RBAC', 'JWT']
  input.skills_structured = {
    security: ['RBAC', 'JWT'],
    platform: ['AWS', 'Kubernetes'],
  }
  input.experience = [
    'Implemented production RBAC/JWT authentication and owned secure API authorization.',
    'Owned AWS deployment pipeline and Kubernetes production rollout for backend services.',
  ]
  input.fit_assessment.matched_requirements = ['Backend API']
  input.fit_assessment.missing_requirements = [
    'secure auth/RBAC implementation depth',
    'AWS/GCP/Kubernetes production cloud experience',
  ]
  input.matchedSkills = ['Backend API']
  input.missingSkills = input.fit_assessment.missing_requirements

  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.auth_security, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.cloud_platforms, 1)
  assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores.auth_security, 1)
  assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores.cloud_platforms, 1)
})

test('rich structured resume evidence does not create standalone JD-fit buckets without comparison overlap', () => {
  const input = candidate()
  input.skills_flat = ['Node.js', 'React', 'AWS', 'Redis', 'RBAC', 'JWT', 'Docker', 'GitHub Actions']
  input.skills_structured = {
    backend: ['Node.js APIs', 'Redis caching', 'RBAC/JWT'],
    platform: ['AWS', 'Docker', 'GitHub Actions CI/CD'],
    frontend: ['React'],
  }
  input.experience = [
    'Built production Node.js APIs with Redis caching, RBAC/JWT, Docker, AWS deployments, and CI/CD.',
  ]
  input.fit_assessment.matched_requirements = []
  input.fit_assessment.missing_requirements = []
  input.matchedSkills = []
  input.missingSkills = []

  const result = scoreCandidateDeterministically(input, { title: 'Unrelated role', location: 'Remote' })
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_match_count, 0)
  assert.equal(result.scoring_breakdown.requirement_match.structured_positive_bucket_count, 0)
  assert.ok(result.scoring_breakdown.requirement_match.score <= 40)
  assert.equal(result.scoring_breakdown.skill_alignment.normalized_requirement_match_count, 0)
  assert.equal(result.scoring_breakdown.skill_alignment.structured_positive_bucket_count, 0)
})

test('structured evidence may cover missing comparison bucket when JD-fit comparison mentions that bucket', () => {
  const input = candidate()
  input.skills_flat = ['AWS']
  input.skills_structured = { platform: ['AWS'] }
  input.experience = ['Owned AWS deployment pipeline for production services.']
  input.fit_assessment.matched_requirements = ['Backend API']
  input.fit_assessment.missing_requirements = ['AWS cloud platform depth']
  input.matchedSkills = ['Backend API']
  input.missingSkills = ['AWS cloud platform depth']

  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.cloud_platforms, 1)
  assert.equal(result.scoring_breakdown.skill_alignment.requirement_bucket_scores.cloud_platforms, 1)
  assert.ok(result.scoring_breakdown.requirement_match.structured_positive_bucket_count > 0)
})

test('structured evidence does not introduce new buckets absent from JD-fit comparison', () => {
  const input = candidate()
  input.skills_flat = ['PostgreSQL', 'Redis', 'RBAC', 'AWS', 'React']
  input.skills_structured = {
    data: ['PostgreSQL'],
    extras: ['Redis', 'RBAC', 'AWS', 'React'],
  }
  input.experience = [
    'Owned PostgreSQL schema design for production APIs.',
    'Also built Redis caching, RBAC auth, AWS deployment, and React UI.',
  ]
  input.fit_assessment.matched_requirements = []
  input.fit_assessment.missing_requirements = ['PostgreSQL database depth']
  input.matchedSkills = []
  input.missingSkills = ['PostgreSQL database depth']

  const result = scoreCandidateDeterministically(input, sdeJdContext())
  const requirementBuckets = result.scoring_breakdown.requirement_match.requirement_bucket_scores
  const skillBuckets = result.scoring_breakdown.skill_alignment.requirement_bucket_scores
  assert.deepEqual(Object.keys(requirementBuckets), ['database_sql'])
  assert.deepEqual(Object.keys(skillBuckets), ['database_sql'])
  assert.equal(requirementBuckets.database_sql, 1)
  assert.equal(skillBuckets.database_sql, 1)
})

test('Docker basics do not cancel production AWS/GCP/Kubernetes cloud gaps', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['Docker basics', 'Render deployment', 'Railway deployment']
  input.fit_assessment.missing_requirements = ['AWS/GCP/Kubernetes production cloud experience']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_match_count, 1)
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_missing_count, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.cloud_platforms, 0)
})

test('TypeScript basics do not cancel TypeScript or Node.js production-depth gaps', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['TypeScript basics']
  input.fit_assessment.missing_requirements = ['TypeScript production experience', 'Node.js production depth']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_match_count, 1)
  assert.ok(result.scoring_breakdown.requirement_match.normalized_requirement_missing_count >= 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.typescript_javascript_node, 0)
})

test('pytest basics and manual testing do not cancel integration testing or CI/CD gaps', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['Pytest basics', 'Manual testing']
  input.fit_assessment.missing_requirements = ['integration testing', 'CI/CD test pipelines']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.ok(result.scoring_breakdown.requirement_match.normalized_requirement_missing_count >= 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.testing_ci, 0)
})

test('true duplicate matched and missing wording still dedupes within the same bucket', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['AWS production cloud experience', 'AWS production cloud experience']
  input.fit_assessment.missing_requirements = ['AWS production cloud experience', 'AWS production cloud experience']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_match_count, 1)
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_missing_count, 0)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.cloud_platforms, 1)
})

test('unknown custom requirement evidence emits only deterministic debug-safe bucket IDs', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['Acme Phoenix migration for ClientZephyr']
  input.fit_assessment.missing_requirements = ['Proprietary Nebula workflow ownership']
  const first = scoreCandidateDeterministically(input, sdeJdContext())
  const second = scoreCandidateDeterministically(structuredClone(input), sdeJdContext())
  const keys = Object.keys(first.scoring_breakdown.requirement_match.requirement_bucket_scores)

  assert.deepEqual(keys, Object.keys(second.scoring_breakdown.requirement_match.requirement_bucket_scores))
  assert.ok(keys.length > 0)
  for (const key of keys) {
    assert.match(key, /^other_[0-9a-f]{8}$/)
    assert.equal(/acme|phoenix|clientzephyr|nebula|workflow|ownership|proprietary/.test(key), false)
  }
  assert.equal(JSON.stringify(first.scoring_breakdown.requirement_match).includes('Acme'), false)
  assert.equal(JSON.stringify(first.scoring_breakdown.requirement_match).includes('phoenix'), false)
})

test('matched C# does not cancel missing C++', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['C# production experience']
  input.fit_assessment.missing_requirements = ['C++ production experience']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.language_csharp, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.language_cpp, 0)
})

test('matched C does not cancel missing C#', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['C programming']
  input.fit_assessment.missing_requirements = ['C# production experience']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.language_c, 1)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.language_csharp, 0)
})

test('Node.js and NodeJS normalize into the same concept bucket', () => {
  const input = candidate()
  input.fit_assessment.matched_requirements = ['Node.js production backend']
  input.fit_assessment.missing_requirements = ['NodeJS production backend']
  const result = scoreCandidateDeterministically(input, sdeJdContext())
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_match_count, 1)
  assert.equal(result.scoring_breakdown.requirement_match.normalized_requirement_missing_count, 0)
  assert.equal(result.scoring_breakdown.requirement_match.requirement_bucket_scores.typescript_javascript_node, 1)
})

describe('production SDE deterministic stability calibration', () => {
  const context = () => ({ ...sdeJdContext(), required_min_years: 4, required_max_years: 7 })
  const guardrailContext = () => ({ ...sdeJdContext(), required_min_years: 2, required_max_years: 5 })
  const spread = (scores) => Math.max(...scores) - Math.min(...scores)

  const strongAishaEvidence = () => ({
    skills_flat: ['TypeScript', 'Node.js', 'Express', 'NestJS', 'React', 'Next.js', 'PostgreSQL', 'Redis', 'Docker', 'AWS', 'Jest', 'GitHub Actions', 'RBAC', 'JWT'],
    skills_structured: {
      backend: ['Built production Node.js, Express, and NestJS REST APIs with PostgreSQL.'],
      frontend: ['Delivered React and Next.js workflows.'],
      platform: ['Deployed Docker services on AWS and used Redis caching.'],
      quality: ['Owned Jest unit tests, integration tests, and CI/CD pipelines.'],
      security: ['Implemented secure APIs with RBAC permissions and JWT authentication.'],
    },
    experience: [
      '4.1 years professional software experience building production backend APIs, PostgreSQL data models, Redis queues, background workers, RBAC/JWT auth, CI/CD, Docker, AWS deployments, incident RCA, and scalable service architecture.',
    ],
    projects: ['Production SaaS workflow using Node.js REST APIs, PostgreSQL, Redis background jobs, React, Next.js, and secure RBAC.'],
    achievements: ['Owned production debugging, reliability improvements, and deployment rollouts.'],
    years_experience: 4.1,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 85,
  })

  const frontendNehaEvidence = () => ({
    skills_flat: ['React', 'Next.js', 'TypeScript', 'Node.js', 'Jest', 'REST APIs'],
    skills_structured: {
      frontend: ['Built production React and Next.js user interfaces with TypeScript.'],
      backend: ['Supported Node.js API integration work.'],
      quality: ['Wrote Jest component tests.'],
    },
    experience: ['2.8 years professional software experience, strongest in frontend React and Next.js with some Node.js API support.'],
    years_experience: 2.8,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 75,
  })

  const juniorVikramEvidence = () => ({
    skills_flat: ['Java', 'SQL', 'React basics', 'Flask basics', 'Express basics', 'Docker basics'],
    skills_structured: {
      languages: ['Java', 'SQL'],
      frameworks: ['React basics', 'Flask basics', 'Express basics'],
      platforms: ['Docker basics', 'Render deployment exposure', 'Railway deployment exposure'],
    },
    experience: ['Resume-derived total experience is 1.6 years of professional software experience.'],
    projects: ['Toy demo app with Docker basics and manual deployment exposure.'],
    years_experience: 1.6,
    location: 'Bengaluru, India',
    confidence: { skills: 0.9, experience: 0.9, fit_assessment: 0.9 },
    profile_score: 70,
  })

  const withNarrative = (base, { matched, missing, risks = [], aiScore = 80, summary = 'AI narrative variant.' }) => ({
    ...base(),
    score: aiScore,
    matchScore: { score: aiScore, reason: summary },
    fit_assessment: {
      overall_fit_score: aiScore,
      rationale: summary,
      matched_requirements: matched,
      missing_requirements: missing,
      risks_or_gaps: risks,
    },
    matchedSkills: matched,
    missingSkills: missing,
  })

  test('Aisha DOC/PDF/DOCX-like narratives stay strong and format-stable from structured evidence', () => {
    const results = [
      withNarrative(strongAishaEvidence, {
        aiScore: 92,
        matched: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis queues', 'RBAC/JWT', 'testing CI/CD', 'AWS/Docker', '4 years experience'],
        missing: ['advanced algorithms'],
      }),
      withNarrative(strongAishaEvidence, {
        aiScore: 86,
        matched: ['Node.js REST APIs', 'React', 'SQL', '4 years professional experience'],
        missing: ['system design depth', 'DSA', 'Kubernetes', 'serverless', 'alternative frameworks', 'high-scale distributed systems'],
        risks: ['Generic scale and Kubernetes gaps should remain considerations.'],
      }),
      withNarrative(strongAishaEvidence, {
        aiScore: 86,
        matched: ['Node APIs', 'PostgreSQL', 'React/Next.js', 'Redis caching', 'testing CI/CD', 'RBAC/JWT', 'AWS deployments', '4 years experience'],
        missing: ['advanced DSA wording'],
        risks: ['Narrative is conservative but structured production evidence is strong.'],
      }),
    ].map((input) => scoreCandidateDeterministically(input, context()))

    const finalScores = results.map((result) => result.final_score)
    assert.ok(Math.min(...finalScores) >= 85, `Aisha scores should stay strong: ${finalScores.join(', ')}`)
    assert.ok(spread(finalScores) <= 5, `Aisha format spread ${spread(finalScores)} from ${finalScores.join(', ')}`)
  })

  test('Aisha-like strong structured SDE candidate with conservative narrative receives final strong floor', () => {
    const result = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 88,
      matched: ['Node.js APIs', 'PostgreSQL', 'React', '4 years professional experience'],
      missing: ['system design depth', 'AWS/Kubernetes cloud depth', 'CI/CD testing depth', 'auth/RBAC depth', 'async/background jobs', 'high-scale distributed systems'],
      risks: ['Conservative narrative omits some structured production details.', 'Legacy migration scope not specified.', 'Observability ownership not specified.', 'Mentorship scope not specified.', 'Roadmap planning not specified.'],
      summary: 'Strong SDE resume evidence, reduced manual review time by 38%, but conservative narrative lists generic depth gaps.',
    }), { ...context(), location: 'Austin, TX' })

    assert.equal(result.final_score_floor_applied, true)
    assert.ok(result.final_score >= 85, `Aisha-like final score should not remain below 85: ${result.final_score}`)
    assert.ok(result.final_score <= 92, `Aisha-like final score should stay in target band: ${result.final_score}`)
    assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, false)
  })

  test('Aisha single-vs-mixed narrative drift does not collapse a strong SDE candidate', () => {
    const richerSingle = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 86,
      matched: ['TypeScript/Node.js backend APIs', 'React/Next.js', 'PostgreSQL', 'Redis queues', 'RBAC/JWT', 'AWS/Docker', 'testing CI/CD', 'system design', '4 years experience'],
      missing: ['advanced algorithms'],
    }), context())
    const conservativeMixed = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 67,
      matched: ['TypeScript/Node.js', 'React', 'PostgreSQL', '4 years experience'],
      missing: ['system design', 'DSA', 'Kubernetes', 'serverless', 'alternative frameworks', 'high-scale distributed systems', 'auth/RBAC depth', 'async/background jobs', 'testing CI/CD'],
      risks: ['Mixed-analysis narrative overstates generic gaps.'],
    }), context())

    assert.ok(richerSingle.final_score >= 85)
    assert.ok(conservativeMixed.final_score >= 85)
    assert.ok(Math.abs(richerSingle.final_score - conservativeMixed.final_score) <= 5)
  })

  test('positive junior mentorship language does not block final strong SDE floor', () => {
    const result = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 88,
      matched: ['Node.js APIs', 'PostgreSQL', 'React', '4 years professional experience'],
      missing: ['system design depth', 'AWS/Kubernetes cloud depth', 'CI/CD testing depth', 'auth/RBAC depth', 'async/background jobs', 'high-scale distributed systems'],
      risks: ['Conservative narrative omits some structured production details.', 'Legacy migration scope not specified.', 'Observability ownership not specified.', 'Mentorship scope not specified.', 'Roadmap planning not specified.'],
      summary: 'Mentored junior engineers and reviewed code for junior teammates while delivering production backend workflow automation.',
    }), { ...context(), location: 'Austin, TX' })

    assert.equal(result.final_score_floor_applied, true)
    assert.ok(result.final_score >= 85)
  })

  test('manual testing weak evidence blocks final strong SDE floor but manual review impact does not', () => {
    const manualReviewImpact = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 88,
      matched: ['Node.js APIs', 'PostgreSQL', 'React', '4 years professional experience'],
      missing: ['system design depth', 'AWS/Kubernetes cloud depth', 'CI/CD testing depth', 'auth/RBAC depth', 'async/background jobs', 'high-scale distributed systems'],
      risks: ['Conservative narrative omits some structured production details.', 'Legacy migration scope not specified.', 'Observability ownership not specified.', 'Mentorship scope not specified.', 'Roadmap planning not specified.'],
      summary: 'Reduced manual review time by 38% while delivering production backend workflow automation.',
    }), { ...context(), location: 'Austin, TX' })
    const manualTestingOnly = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 52,
      matched: ['Node.js APIs', 'PostgreSQL', 'React', '4 years professional experience'],
      missing: ['system design depth', 'AWS/Kubernetes cloud depth', 'CI/CD testing depth', 'auth/RBAC depth', 'async/background jobs', 'high-scale distributed systems'],
      risks: ['Manual testing only; weak structured delivery evidence.', 'Legacy migration scope not specified.', 'Observability ownership not specified.', 'Mentorship scope not specified.', 'Roadmap planning not specified.'],
      summary: 'Manual API testing only, with weak evidence for production SDE ownership.',
    }), { ...context(), location: 'Austin, TX' })

    assert.equal(manualReviewImpact.final_score_floor_applied, true)
    assert.ok(manualReviewImpact.final_score >= 85)
    assert.equal(manualTestingOnly.final_score_floor_applied, false)
    assert.ok(manualTestingOnly.final_score < 85)
  })

  test('weak junior-profile language blocks final strong SDE floor', () => {
    const juniorProfile = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      aiScore: 52,
      matched: ['Node.js APIs', 'PostgreSQL', 'React', '4 years professional experience'],
      missing: ['system design depth', 'AWS/Kubernetes cloud depth', 'CI/CD testing depth', 'auth/RBAC depth', 'async/background jobs', 'high-scale distributed systems'],
      risks: ['Junior profile; weak structured delivery evidence.', 'Legacy migration scope not specified.', 'Observability ownership not specified.', 'Roadmap planning not specified.'],
      summary: 'Junior candidate. Junior developer with basic exposure.',
    }), { ...context(), location: 'Austin, TX' })

    assert.equal(juniorProfile.final_score_floor_applied, false)
    assert.ok(juniorProfile.final_score < 85)
  })

  test('frontend-only or junior/basic structured evidence does not trigger final strong SDE floor', () => {
    const frontendOnly = scoreCandidateDeterministically(withNarrative(frontendNehaEvidence, {
      aiScore: 61,
      matched: ['React/Next.js', 'TypeScript frontend', 'Jest testing'],
      missing: ['backend ownership depth', 'database delivery', 'cloud/platform depth', 'system design', 'queues/background jobs', 'auth/RBAC'],
      risks: ['Frontend-only profile with limited backend delivery depth.'],
    }), guardrailContext())
    const juniorBasic = scoreCandidateDeterministically(withNarrative(juniorVikramEvidence, {
      aiScore: 52,
      summary: 'Junior profile with basics and below minimum experience.',
      matched: ['Java', 'SQL', 'Docker basics'],
      missing: ['minimum 2 years experience', 'production backend ownership', 'system design', 'cloud', 'testing CI/CD', 'auth/RBAC', 'queues/background jobs'],
      risks: ['Junior profile; basic structured evidence only.'],
    }), guardrailContext())

    assert.equal(frontendOnly.final_score_floor_applied, false)
    assert.ok(frontendOnly.final_score < 85)
    assert.equal(juniorBasic.final_score_floor_applied, false)
    assert.ok(juniorBasic.final_score < 85)
  })

  test('Neha and Vikram guardrails plus mixed ranking remain intact', () => {
    const aisha = scoreCandidateDeterministically(withNarrative(strongAishaEvidence, {
      matched: ['TypeScript/Node.js', 'React', 'PostgreSQL', '4 years experience'],
      missing: ['system design', 'DSA', 'Kubernetes', 'serverless'],
      risks: ['Generic gaps only.'],
    }), context())
    const neha = scoreCandidateDeterministically(withNarrative(frontendNehaEvidence, {
      aiScore: 60,
      matched: ['React/Next.js', 'TypeScript frontend', 'Jest testing', 'some Node APIs', '2.8 years experience'],
      missing: ['cloud/platform depth', 'system design', 'queues/background jobs', 'auth/RBAC'],
      risks: ['Frontend-leaning profile.'],
    }), guardrailContext())
    const vikram = scoreCandidateDeterministically(withNarrative(juniorVikramEvidence, {
      aiScore: 52,
      summary: 'Candidate has 1.6 years experience and is below minimum for the role.',
      matched: ['Java', 'SQL', 'backend APIs'],
      missing: ['minimum 4 years experience', 'system design', 'cloud', 'testing CI/CD', 'auth/RBAC', 'queues/background jobs'],
      risks: ['Experience gap: 1.6 years is below minimum for 4-7 years', 'Junior profile for SDE ownership'],
    }), guardrailContext())

    assert.ok(neha.final_score >= 58 && neha.final_score <= 62, `Neha should remain moderate: ${neha.final_score}`)
    assert.ok(vikram.final_score >= 49 && vikram.final_score <= 55, `Vikram should remain junior/below-threshold: ${vikram.final_score}`)
    assert.ok(aisha.final_score > neha.final_score)
    assert.ok(aisha.final_score - neha.final_score >= 20)
    assert.ok(neha.final_score > vikram.final_score)
  })
})
