import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveUserSectionPath } from './userNavigation.js'

test('dashboard routes resolve to canonical /dashboard route', () => {
  assert.equal(resolveUserSectionPath('/dashboard'), '/dashboard')
  assert.equal(resolveUserSectionPath('/'), '/dashboard')
  assert.equal(resolveUserSectionPath('/account/dashboard'), '/dashboard')
})

test('dashboard canonical route remains stable for direct reload', () => {
  const hardRefreshPath = '/dashboard'
  assert.equal(resolveUserSectionPath(hardRefreshPath), '/dashboard')
})
