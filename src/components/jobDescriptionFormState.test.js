import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSalaryCurrency,
  serializeJobDescriptionForm,
  validateJobDescriptionForm,
} from './jobDescriptionFormState.js'

test('normalizeSalaryCurrency defaults to USD for invalid values', () => {
  assert.equal(normalizeSalaryCurrency('eur'), 'EUR')
  assert.equal(normalizeSalaryCurrency('zzz'), 'USD')
})

test('validateJobDescriptionForm blocks invalid salary ranges and unsupported currencies', () => {
  const errors = validateJobDescriptionForm({ salaryMin: '100', salaryMax: '10', salaryCurrency: 'XYZ' })
  assert.equal(errors.salaryMin, 'Salary min cannot be greater than salary max')
  assert.equal(errors.salaryCurrency, 'Please choose a supported salary currency')
})

test('serializeJobDescriptionForm persists uppercase supported currency', () => {
  const result = serializeJobDescriptionForm({ title: 'Eng', salaryCurrency: 'gbp' })
  assert.equal(result.salaryCurrency, 'GBP')
})

test('serializeJobDescriptionForm appends optional metadata fields when provided', () => {
  const result = serializeJobDescriptionForm({
    title: 'Eng',
    salaryCurrency: 'usd',
    department: ' Engineering ',
    employmentType: 'full-time',
    priority: '3',
    archivedReason: 'Filled',
    sourceType: 'import',
    version: '2',
  })

  assert.equal(result.department, 'Engineering')
  assert.equal(result.employmentType, 'full-time')
  assert.equal(result.priority, 3)
  assert.equal(result.archivedReason, 'Filled')
  assert.equal(result.sourceType, 'import')
  assert.equal(result.version, 2)
})
