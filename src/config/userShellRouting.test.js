import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizePathname,
  getAnalysisDetailRouteId,
  getCandidateDetailRouteId,
  isAuthenticatedAccountShellRoutePath,
  isAuthenticatedHistoricalRoutePath,
  isCheckoutStandaloneRoutePath,
  isPaidWorkspaceRoutePath,
  isStandaloneOrdinaryUserAuthRoutePath,
  isUserShellRoutePath,
  normalizeLegacyAccountPath,
} from './userShellRouting.js'

test('canonicalizes trailing slashes without changing root', () => {
  assert.equal(canonicalizePathname('/'), '/')
  assert.equal(canonicalizePathname('/analyses/'), '/analyses')
  assert.equal(canonicalizePathname('/candidates/'), '/candidates')
  assert.equal(canonicalizePathname('/settings/'), '/settings')
  assert.equal(canonicalizePathname('/billing/'), '/billing')
  assert.equal(canonicalizePathname('/analyses/abc/'), '/analyses/abc')
  assert.equal(canonicalizePathname('/candidates/abc/'), '/candidates/abc')
  assert.equal(canonicalizePathname('/results/shared-token'), '/results/shared-token')
})

test('classifies exact paid workspace base routes with canonical trailing slash handling', () => {
  for (const path of ['/dashboard', '/dashboard/legacy', '/job-descriptions', '/jobs', '/analyses', '/analyses/', '/candidates', '/candidates/', '/shortlists', '/reports', '/uploader', '/create-analysis']) {
    assert.equal(isPaidWorkspaceRoutePath(path), true, `${path} should be paid`)
  }

  assert.equal(isPaidWorkspaceRoutePath('/analyses/abc'), false)
  assert.equal(isPaidWorkspaceRoutePath('/candidates/abc'), false)
  assert.equal(isAuthenticatedHistoricalRoutePath('/analyses/abc'), true)
  assert.equal(isAuthenticatedHistoricalRoutePath('/candidates/abc'), true)
})

test('classifies account-only eligible authenticated routes with canonical trailing slash handling', () => {
  for (const path of ['/settings', '/settings/', '/billing', '/billing/', '/account/payment-method', '/account/payment-method/', '/results', '/analyses/abc', '/analyses/abc/', '/candidates/abc', '/candidates/abc/']) {
    assert.equal(isAuthenticatedAccountShellRoutePath(path), true, `${path} should be account-shell eligible`)
    assert.equal(isUserShellRoutePath(path), true, `${path} should be authenticated-shell eligible`)
  }
})

test('detail helpers require exactly one non-empty id segment', () => {
  assert.equal(getAnalysisDetailRouteId('/analyses/abc'), 'abc')
  assert.equal(getAnalysisDetailRouteId('/analyses/abc/'), 'abc')
  assert.equal(getAnalysisDetailRouteId('/analyses'), null)
  assert.equal(getAnalysisDetailRouteId('/analyses/abc/extra'), null)
  assert.equal(getCandidateDetailRouteId('/candidates/abc'), 'abc')
  assert.equal(getCandidateDetailRouteId('/candidates/abc/'), 'abc')
  assert.equal(getCandidateDetailRouteId('/candidates'), null)
  assert.equal(getCandidateDetailRouteId('/candidates/abc/extra'), null)
})

test('keeps checkout, shared-result, and admin routes standalone for ordinary auth sync', () => {
  for (const path of ['/checkout', '/billing/success', '/billing/cancel']) {
    assert.equal(isCheckoutStandaloneRoutePath(path), true, `${path} should be standalone`)
    assert.equal(isUserShellRoutePath(path), false, `${path} should not be a new shell route`)
    assert.equal(isStandaloneOrdinaryUserAuthRoutePath(path), true, `${path} should bypass ordinary auth sync`)
  }

  assert.equal(isStandaloneOrdinaryUserAuthRoutePath('/results/shared-token'), true)
  assert.equal(isStandaloneOrdinaryUserAuthRoutePath('/admin'), true)
  assert.equal(isStandaloneOrdinaryUserAuthRoutePath('/admin/login'), true)
  assert.equal(isAuthenticatedAccountShellRoutePath('/account/payment-method'), true)
  assert.equal(isUserShellRoutePath('/account/payment-method'), true)
})

test('normalizes legacy account alias safely', () => {
  assert.equal(normalizeLegacyAccountPath('/account', ''), '/settings')
  assert.equal(normalizeLegacyAccountPath('/account/', '?section=billing'), '/settings')
  assert.equal(normalizeLegacyAccountPath('/account', '?upgradeTestKey=abc&section=billing'), '/settings?upgradeTestKey=abc')
  assert.equal(normalizeLegacyAccountPath('/settings', ''), null)
})
