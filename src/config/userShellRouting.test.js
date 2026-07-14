import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizePathname,
  canAccessRouteForSubscriptionState,
  getAnalysisDetailRouteId,
  getCandidateDetailRouteId,
  isAuthenticatedAccountShellRoutePath,
  isAuthenticatedHistoricalRoutePath,
  isCheckoutStandaloneRoutePath,
  isPaidMutationWorkspaceRoutePath,
  isPaidWorkspaceRoutePath,
  isReadOnlyWorkspaceRoutePath,
  isStandaloneOrdinaryUserAuthRoutePath,
  isUserShellRoutePath,
  normalizeLegacyAccountPath,
} from './userShellRouting.js'
import { resolveSubscriptionState } from '../utils/subscriptionState.js'

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

test('classifies future read-only workspace candidate routes without changing routing behavior', () => {
  for (const path of ['/dashboard', '/jobs', '/job-descriptions', '/analyses', '/analyses/abc', '/candidates', '/candidates/abc', '/shortlists', '/reports', '/results']) {
    assert.equal(isReadOnlyWorkspaceRoutePath(path), true, `${path} should be a future read-only workspace candidate`)
  }

  assert.equal(isReadOnlyWorkspaceRoutePath('/dashboard/legacy'), false)
  assert.equal(isReadOnlyWorkspaceRoutePath('/uploader'), false)
  assert.equal(isReadOnlyWorkspaceRoutePath('/create-analysis'), false)
})

test('classifies paid mutation workspace routes separately from read-only candidates', () => {
  for (const path of ['/uploader', '/uploader/', '/create-analysis', '/create-analysis/']) {
    assert.equal(isPaidMutationWorkspaceRoutePath(path), true, `${path} should require paid mutation access`)
    assert.equal(isReadOnlyWorkspaceRoutePath(path), false, `${path} should not be read-only workspace`)
  }
})

test('keeps account, public, admin, and auth routes out of read-only workspace classification', () => {
  for (const path of ['/billing', '/settings', '/login', '/signup', '/pricing', '/checkout', '/admin', '/admin/uploads', '/results/shared-token']) {
    assert.equal(isReadOnlyWorkspaceRoutePath(path), false, `${path} should not be mixed into read-only workspace`)
  }

  assert.equal(canAccessRouteForSubscriptionState('/billing', { status: 'inactive' }), true)
  assert.equal(canAccessRouteForSubscriptionState('/settings', { status: 'inactive' }), true)
})

test('route policy helper distinguishes read-only candidates from paid mutation routes', () => {
  const inactiveWithHistory = { status: 'inactive' }
  const active = { status: 'active' }

  assert.equal(canAccessRouteForSubscriptionState('/analyses', inactiveWithHistory, { hasHistoricalData: true }), true)
  assert.equal(canAccessRouteForSubscriptionState('/uploader', inactiveWithHistory, { hasHistoricalData: true }), false)
  assert.equal(canAccessRouteForSubscriptionState('/create-analysis', inactiveWithHistory, { hasHistoricalData: true }), false)
  assert.equal(canAccessRouteForSubscriptionState('/uploader', active, { hasHistoricalData: true }), true)
  assert.equal(canAccessRouteForSubscriptionState('/login', active, { hasHistoricalData: true }), false)
})

test('route policy helper honors resolved read-only subscription state booleans', () => {
  const resolvedState = resolveSubscriptionState({
    subscription: { status: 'inactive', hasHistoricalData: true },
  })

  assert.equal(resolvedState.isReadOnlyWorkspace, true)
  for (const path of ['/dashboard', '/analyses', '/jobs', '/job-descriptions', '/candidates/candidate-123', '/results']) {
    assert.equal(canAccessRouteForSubscriptionState(path, resolvedState), true, `${path} should allow resolved read-only access`)
  }

  assert.equal(canAccessRouteForSubscriptionState('/uploader', resolvedState), false)
  assert.equal(canAccessRouteForSubscriptionState('/create-analysis', resolvedState), false)
})

test('route policy helper honors resolved paid mutation state booleans', () => {
  const resolvedState = resolveSubscriptionState({
    subscription: { status: 'active', hasHistoricalData: true },
  })

  assert.equal(resolvedState.canUsePaidMutation, true)
  assert.equal(canAccessRouteForSubscriptionState('/uploader', resolvedState), true)
  assert.equal(canAccessRouteForSubscriptionState('/create-analysis', resolvedState), true)
})

test('route policy helper requires historical-data option for raw inactive read-only candidates', () => {
  const rawInactive = { status: 'inactive' }

  assert.equal(canAccessRouteForSubscriptionState('/analyses', rawInactive), false)
  assert.equal(canAccessRouteForSubscriptionState('/analyses', rawInactive, { hasHistoricalData: true }), true)
})

test('route policy helper keeps public auth and admin routes denied', () => {
  const resolvedReadOnly = resolveSubscriptionState({
    subscription: { status: 'inactive', hasHistoricalData: true },
  })

  for (const path of ['/', '/login', '/signup', '/pricing', '/checkout', '/admin', '/admin/uploads']) {
    assert.equal(canAccessRouteForSubscriptionState(path, resolvedReadOnly), false, `${path} should not be allowed by subscription route policy`)
  }
})
