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

test('new deterministic service is not imported by guarded runtime paths', () => {
  for (const path of ['backend/src/jobs/parseResumeJob.js', 'backend/src/routes/results.js', 'backend/src/routes/candidates.js']) {
    const source = readFileSync(resolve(path), 'utf8')
    assert.equal(source.includes('deterministicJdFitScoringService'), false, `${path} must not import the scorer`)
    assert.equal(source.includes('scoreCandidateDeterministically'), false, `${path} must not call the scorer`)
  }
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
