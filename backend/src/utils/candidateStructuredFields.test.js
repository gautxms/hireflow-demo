import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeCandidateFieldArray } from './candidateStructuredFields.js'

test('normalizes education object arrays into readable summaries', () => {
  const result = normalizeCandidateFieldArray([
    { degree: 'MBA', institution: 'IIM Bangalore', year: 2021 },
  ], { fieldName: 'education' })

  assert.deepEqual(result, ['MBA, IIM Bangalore (2021)'])
})

test('normalizes experience object arrays into readable summaries', () => {
  const result = normalizeCandidateFieldArray([
    { title: 'Senior Engineer', company: 'Acme', dates: '2020-2024', summary: 'Built hiring workflows.' },
  ], { fieldName: 'experience' })

  assert.deepEqual(result, ['Senior Engineer at Acme — 2020-2024: Built hiring workflows.'])
})

test('normalizes project object arrays into readable summaries', () => {
  const result = normalizeCandidateFieldArray([
    { name: 'Talent Match', description: 'Candidate ranking app', technologies: ['React', 'Node'] },
  ], { fieldName: 'projects' })

  assert.deepEqual(result, ['Talent Match — Candidate ranking app — Technologies: React, Node'])
})

test('filters literal object placeholders and summarizes unknown scalar fields', () => {
  const result = normalizeCandidateFieldArray([
    '[object Object]',
    { noisy: { nested: true }, useful: 'Useful detail', count: 3 },
  ], { fieldName: 'unknown' })

  assert.deepEqual(result, ['Useful detail — 3'])
})
