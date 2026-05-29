import test from 'node:test'
import assert from 'node:assert/strict'

import { formatEducationForDisplay, normalizeCandidateEducation } from './candidateEducation.js'

test('normalizeCandidateEducation preserves AI structured education entries', () => {
  const education = normalizeCandidateEducation([
    { degree: 'MBA', school: 'Example University', graduation_year: '2010' },
  ])

  assert.deepEqual(education, [
    { degree: 'MBA', school: 'Example University', graduation_year: 2010 },
  ])
})

test('normalizeCandidateEducation keeps legacy string entries and rejects object coercion artifacts', () => {
  const education = normalizeCandidateEducation([
    'BSc Computer Science',
    '[object Object]',
    { label: 'Executive Program, Example School' },
  ])

  assert.deepEqual(education, ['BSc Computer Science', 'Executive Program, Example School'])
})

test('formatEducationForDisplay renders mixed legacy and structured education safely', () => {
  assert.equal(
    formatEducationForDisplay([
      { degree: 'MBA', school: 'Example University', graduation_year: 2010 },
      'BSc Computer Science',
      '[object Object]',
    ], 'Unavailable'),
    'MBA, Example University (2010) | BSc Computer Science',
  )
})
