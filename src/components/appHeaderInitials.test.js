import test from 'node:test'
import assert from 'node:assert/strict'
import { getAppHeaderInitials } from './appHeaderInitials.js'

test('app header initials fall back to the login email initial', () => {
  assert.equal(getAppHeaderInitials({ email: 'candidate@example.com' }), 'C')
})

test('app header initials preserve existing name-based initials when present', () => {
  assert.equal(getAppHeaderInitials({ name: 'Ada Lovelace', email: 'candidate@example.com' }), 'AL')
})

test('app header initials default to U without a usable name or email', () => {
  assert.equal(getAppHeaderInitials({ name: '   ', email: '   ' }), 'U')
  assert.equal(getAppHeaderInitials(null), 'U')
})
