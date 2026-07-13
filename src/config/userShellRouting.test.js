import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAuthenticatedAccountShellRoutePath,
  isAuthenticatedHistoricalRoutePath,
  isCheckoutStandaloneRoutePath,
  isPaidWorkspaceRoutePath,
  isUserShellRoutePath,
  normalizeLegacyAccountPath,
} from './userShellRouting.js'

test('classifies exact paid workspace base routes without swallowing detail routes', () => {
  for (const path of ['/dashboard', '/dashboard/legacy', '/job-descriptions', '/jobs', '/analyses', '/candidates', '/shortlists', '/reports', '/uploader', '/create-analysis']) {
    assert.equal(isPaidWorkspaceRoutePath(path), true, `${path} should be paid`)
  }

  assert.equal(isPaidWorkspaceRoutePath('/analyses/abc'), false)
  assert.equal(isPaidWorkspaceRoutePath('/candidates/abc'), false)
  assert.equal(isAuthenticatedHistoricalRoutePath('/analyses/abc'), true)
  assert.equal(isAuthenticatedHistoricalRoutePath('/candidates/abc'), true)
})

test('classifies account-only eligible authenticated routes', () => {
  for (const path of ['/settings', '/billing', '/results', '/analyses/abc', '/candidates/abc']) {
    assert.equal(isAuthenticatedAccountShellRoutePath(path), true, `${path} should be account-shell eligible`)
    assert.equal(isUserShellRoutePath(path), true, `${path} should be authenticated-shell eligible`)
  }
})

test('keeps checkout and billing return routes standalone', () => {
  for (const path of ['/checkout', '/billing/success', '/billing/cancel']) {
    assert.equal(isCheckoutStandaloneRoutePath(path), true, `${path} should be standalone`)
    assert.equal(isUserShellRoutePath(path), false, `${path} should not be a new shell route`)
  }

  assert.equal(isUserShellRoutePath('/account/payment-method'), true)
})

test('normalizes legacy account alias safely', () => {
  assert.equal(normalizeLegacyAccountPath('/account', ''), '/settings')
  assert.equal(normalizeLegacyAccountPath('/account', '?section=billing'), '/settings')
  assert.equal(normalizeLegacyAccountPath('/account', '?upgradeTestKey=abc&section=billing'), '/settings?upgradeTestKey=abc')
  assert.equal(normalizeLegacyAccountPath('/settings', ''), null)
})
