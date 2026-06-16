import test from 'node:test'
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

  assert.equal(doc.score_band, 'weak')
  assert.equal(pdf.score_band, 'weak')
  for (const result of [doc, pdf, docx]) {
    assert.ok(result.scoring_breakdown.experience_alignment.score >= 50)
    assert.ok(result.scoring_breakdown.experience_alignment.score <= 60)
    assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  }
  assert.notEqual(docx.scoring_breakdown.experience_alignment.score, 100)
  assert.ok(Math.max(doc.final_score, pdf.final_score, docx.final_score) - Math.min(doc.final_score, pdf.final_score, docx.final_score) <= 5)
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

test('candidate years_experience of 2 is capped when text says 1.6 years', () => {
  const input = candidate()
  input.years_experience = 2
  input.summary = 'Candidate has 1.6 years of experience, below minimum.'
  const result = scoreCandidateDeterministically(input, { ...jdContext(), required_min_years: 2 })
  assert.equal(result.scoring_breakdown.experience_alignment.below_min_experience_evidence_applied, true)
  assert.ok(result.scoring_breakdown.experience_alignment.score <= 60)
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
