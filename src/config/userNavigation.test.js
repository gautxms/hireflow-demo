import test from 'node:test'
import assert from 'node:assert/strict'
import { USER_SECTION_ALIASES, USER_SECTION_NAVIGATION, resolveUserSectionPath } from './userNavigation.js'

const SUBSCRIBED_SMOKE_ROUTES = [
  '/dashboard',
  '/jobs',
  '/analyses',
  '/candidates',
  '/shortlists',
  '/reports',
  '/settings',
]

test('subscribed route smoke paths resolve to valid user sections on direct load', () => {
  const knownSectionHrefs = new Set(USER_SECTION_NAVIGATION.map((section) => section.href))

  for (const route of SUBSCRIBED_SMOKE_ROUTES) {
    const resolved = resolveUserSectionPath(route)

    if (route === '/dashboard') {
      assert.equal(resolved, '/dashboard')
      continue
    }

    assert.ok(
      knownSectionHrefs.has(resolved),
      `Expected ${route} to resolve to a known section href, received ${resolved}`,
    )
  }
})

test('navigation aliases for subscribed smoke routes remain canonical and stable', () => {
  assert.equal(USER_SECTION_ALIASES['/jobs'], '/job-descriptions')
  assert.equal(USER_SECTION_ALIASES['/analyses'], '/analyses')
  assert.equal(USER_SECTION_ALIASES['/candidates'], '/candidates')
  assert.equal(USER_SECTION_ALIASES['/shortlists'], '/results')
  assert.equal(USER_SECTION_ALIASES['/reports'], '/reports')
  assert.equal(USER_SECTION_ALIASES['/settings'], '/settings')
})

test('smoke-route sections are authenticated and avoid not-found fallback mappings', () => {
  const sectionByHref = new Map(USER_SECTION_NAVIGATION.map((section) => [section.href, section]))

  for (const route of SUBSCRIBED_SMOKE_ROUTES.filter((route) => route !== '/dashboard')) {
    const href = resolveUserSectionPath(route)
    const section = sectionByHref.get(href)

    assert.ok(section, `Expected route ${route} to map to a known section`) 
    assert.equal(section.requiresAuth, true)
  }

  const jobsSection = sectionByHref.get(resolveUserSectionPath('/jobs'))
  assert.equal(jobsSection?.requiresActiveSubscription, true)
})


test('root path is no longer treated as a dashboard alias', () => {
  assert.equal(resolveUserSectionPath('/'), '/')
  assert.ok(!Object.hasOwn(USER_SECTION_ALIASES, '/'))
})
