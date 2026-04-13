import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDemoRequestError, validateDemoRequestForm } from './demoRequestValidation.js'

test('validateDemoRequestForm reports required field errors', () => {
  const errors = validateDemoRequestForm({ name: '', email: 'bad', company: '', message: '' })
  assert.equal(Boolean(errors.name), true)
  assert.equal(Boolean(errors.email), true)
  assert.equal(Boolean(errors.company), true)
  assert.equal(Boolean(errors.message), true)
})

test('parseDemoRequestError falls back when response is not json', async () => {
  const message = await parseDemoRequestError({
    json: async () => {
      throw new Error('not-json')
    },
  })

  assert.equal(message, 'Failed to submit demo request')
})

test('parseDemoRequestError returns API error message when available', async () => {
  const message = await parseDemoRequestError({
    json: async () => ({ error: 'Service unavailable' }),
  })

  assert.equal(message, 'Service unavailable')
})
