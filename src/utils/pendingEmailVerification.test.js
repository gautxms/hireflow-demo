import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PENDING_VERIFICATION_EMAIL_STORAGE_KEY,
  clearPendingVerificationEmail,
  normalizePendingVerificationEmail,
  readPendingVerificationEmail,
  storePendingVerificationEmail,
} from './pendingEmailVerification.js'

function createMemoryStorage() {
  const values = new Map()

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

test('normalizes and validates a pending verification email', () => {
  assert.equal(normalizePendingVerificationEmail('  Recruiter+Trial@Example.COM '), 'recruiter+trial@example.com')
  assert.equal(normalizePendingVerificationEmail('not-an-email'), '')
  assert.equal(normalizePendingVerificationEmail(null), '')
})

test('keeps the pending account email in tab-scoped storage', () => {
  const storage = createMemoryStorage()

  assert.equal(storePendingVerificationEmail(' Recruiter@Example.com ', storage), 'recruiter@example.com')
  assert.equal(storage.getItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY), 'recruiter@example.com')
  assert.equal(readPendingVerificationEmail(storage), 'recruiter@example.com')

  clearPendingVerificationEmail(storage)
  assert.equal(readPendingVerificationEmail(storage), '')
})

test('fails closed when pending verification storage is unavailable or corrupted', () => {
  const unavailableStorage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
    removeItem() {
      throw new Error('blocked')
    },
  }
  const corruptedStorage = createMemoryStorage()
  corruptedStorage.setItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY, 'invalid value')

  assert.equal(storePendingVerificationEmail('user@example.com', unavailableStorage), 'user@example.com')
  assert.equal(readPendingVerificationEmail(unavailableStorage), '')
  assert.equal(readPendingVerificationEmail(corruptedStorage), '')
  assert.doesNotThrow(() => clearPendingVerificationEmail(unavailableStorage))
})
