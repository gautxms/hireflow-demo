import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PUBLIC_ROUTE_MANIFEST, PUBLIC_ROUTE_PATHS } from './publicRouteManifest.js'
import {
  PROTECTED_ROUTE_EXACT_PATHS,
  ROUTE_ACCESS,
  isProtectedRoutePath,
  validatePublicRouteManifest,
} from './routeClassification.js'

const publicRoute = (path, overrides = {}) => ({
  path,
  componentKey: 'fixture',
  access: ROUTE_ACCESS.PUBLIC,
  indexable: true,
  staticGeneration: true,
  ...overrides,
})

test('known authenticated and admin routes are protected', () => {
  assert.equal(isProtectedRoutePath('/dashboard'), true)
  assert.equal(isProtectedRoutePath('/admin/users'), true)
  assert.equal(isProtectedRoutePath('/account/billing'), true)
  assert.equal(isProtectedRoutePath('/pricing'), false)
})

test('validation rejects a known authenticated route in static generation', () => {
  assert.throws(
    () => validatePublicRouteManifest([publicRoute('/dashboard')]),
    /Protected route cannot be statically generated or indexed/,
  )
})

test('validation rejects an admin descendant in static generation', () => {
  assert.throws(
    () => validatePublicRouteManifest([publicRoute('/admin/users')]),
    /Protected route cannot be statically generated or indexed/,
  )
})

test('validation rejects contradictory protected metadata', () => {
  assert.throws(
    () => validatePublicRouteManifest([publicRoute('/pricing', { access: ROUTE_ACCESS.PROTECTED })]),
    /Contradictory route classification/,
  )
})

test('authoritative protected exact routes are unique', () => {
  assert.equal(new Set(PROTECTED_ROUTE_EXACT_PATHS).size, PROTECTED_ROUTE_EXACT_PATHS.length)
})

test('App derives public route paths from the shared manifest', () => {
  const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  assert.ok(appSource.includes("import { PUBLIC_ROUTE_PATHS } from './config/publicRouteManifest'"))
  assert.ok(!appSource.includes('const PUBLIC_ROUTE_PATHS = new Set'))
  assert.deepEqual(
    [...PUBLIC_ROUTE_PATHS].sort(),
    PUBLIC_ROUTE_MANIFEST.map((route) => route.path).sort(),
  )
})
