import test from 'node:test'
import assert from 'node:assert/strict'
import { schemas } from './validation.js'

test('paddle checkout validation accepts monthly annual and hidden test-monthly', () => {
  for (const plan of ['monthly', 'annual', 'test-monthly']) {
    const { error, value } = schemas.paddleCheckout.validate({ plan, testKey: 'optional-key' })
    assert.equal(error, undefined)
    assert.equal(value.plan, plan)
  }
})

test('paddle checkout validation rejects unknown plans', () => {
  const { error } = schemas.paddleCheckout.validate({ plan: 'weekly' })
  assert.ok(error)
})
