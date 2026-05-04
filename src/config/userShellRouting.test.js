import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveUserSectionPath } from './userNavigation.js'
import { isUserShellRoutePath } from './userShellRouting.js'

test('shell routing treats canonical dashboard, analyses, and results paths as shell routes', () => {
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/dashboard')), true)
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/analyses')), true)
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/results')), true)
})

test('shell routing treats aliases as shell routes after path normalization', () => {
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/shortlists')), true)
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/jobs')), true)
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/account/analyses')), true)
})

test('shell routing keeps root path outside the user shell', () => {
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/')), false)
})

