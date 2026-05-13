import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeCandidateExperience, parseExperienceTextToYears } from './experienceNormalization.js'

test('parseExperienceTextToYears parses supported expressions', () => {
  const cases = [
    ['3 years of experience', 3],
    ['5.2 years experience', 5.2],
    ['5+ years', 5],
    ['more than 5 years', 5],
    ['over 6 years', 6],
    ['nearly 7 years', 7],
    ['around 4.5 years', 4.5],
    ['9 months', 0.75],
    ['18 months', 1.5],
    ['1 year 6 months', 1.5],
    ['2 years and 3 months', 2.25],
    ['3-5 years', 3],
    ['5 to 7 years', 5],
    ['between 4 and 6 years', 4],
    ['fresher', 0],
  ]
  for (const [input, expected] of cases) {
    assert.equal(parseExperienceTextToYears(input), expected)
  }
})

test('parseExperienceTextToYears rejects unrelated numbers and ambiguous text', () => {
  const cases = [
    'managed 25+ web applications',
    'created 10 dashboards',
    'worked from 2021 to present',
    'score 8.2/10',
    'extensive experience',
    'experienced business analyst',
    '',
    null,
  ]
  for (const input of cases) {
    assert.equal(parseExperienceTextToYears(input), null)
  }
})

test('normalizeCandidateExperience uses structured fields first and legacy fallback last', () => {
  const structured = normalizeCandidateExperience({ totalExperienceYears: 8, relevantExperienceYears: 6, experienceSource: 'resume' })
  assert.equal(structured.totalExperienceYears, 8)
  assert.equal(structured.experienceSource, 'resume')

  const fallback = normalizeCandidateExperience({ summary: 'Business analyst with 3+ years experience.' })
  assert.equal(fallback.totalExperienceYears, 3)
  assert.equal(fallback.experienceSource, 'legacy_text_fallback')
  assert.equal(fallback.experienceConfidence, 'low')
})

test('normalizeCandidateExperience falls back to legacy numeric fields when totalExperienceYears is invalid', () => {
  const normalized = normalizeCandidateExperience({
    totalExperienceYears: 'N/A',
    years_experience: 7,
  })

  assert.equal(normalized.totalExperienceYears, 7)
})

test('normalizeCandidateExperience aggregates array-based legacy experience entries', () => {
  const normalized = normalizeCandidateExperience({
    experience: ['2 years', '3 years', '18 months'],
  })

  assert.equal(normalized.totalExperienceYears, 6.5)
  assert.equal(normalized.experienceSource, 'legacy_text_fallback')
})

test('normalizeCandidateExperience estimates overlapping date ranges without double counting', () => {
  const normalized = normalizeCandidateExperience({
    experience: [
      { startDate: '01/2020', endDate: '12/2021' },
      { startDate: '2021', endDate: '2023' },
      { startDate: '2022-06-01', endDate: 'Present' },
    ],
  })

  assert.equal(normalized.isEstimated, true)
  assert.equal(normalized.experienceSource, 'interval_estimate')
  assert.equal(normalized.totalExperienceYears > 0, true)
  assert.equal(normalized.totalExperienceYears <= 10, true)
  assert.equal(normalized.evidence.length, 3)
})
