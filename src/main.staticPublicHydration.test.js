import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldHydrateStaticPublicRoute } from './public/staticPublicRouteHydration.js'

const mainSource = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8')

test('only marked, statically generated public routes enter hydration', () => {
  const decide = (pathname, hasPrerenderedPublicMarkup = true) => shouldHydrateStaticPublicRoute({
    hasPrerenderedPublicMarkup,
    pathname,
  })

  assert.equal(decide('/'), true)
  assert.equal(decide('/pricing/'), true)
  assert.equal(decide('/pricing?source=direct'), true)
  assert.equal(decide('/', false), false)

  assert.equal(decide('/demo'), false)
  assert.equal(decide('/login'), false)
  assert.equal(decide('/dashboard'), false)
  assert.equal(decide('/account/billing'), false)
  assert.equal(decide('/admin/users'), false)
})

test('main gates static hydration through the shared route-manifest decision', () => {
  assert.match(mainSource, /shouldHydrateStaticPublicRoute\(\{[\s\S]*hasPrerenderedPublicMarkup: root\.hasAttribute\('data-static-public-route'\)[\s\S]*pathname: window\.location\.pathname/)
  assert.match(mainSource, /if \(shouldHydratePrerenderedRoute && !hasStoredAuthenticatedSession\(\)\)/)
  assert.doesNotMatch(mainSource, /if \(root\.hasAttribute\('data-static-public-route'\)\)/)
})

test('anonymous static public routes hydrate the matching prerendered tree in place', () => {
  assert.match(mainSource, /hydrateRoot\([\s\S]*<PublicRouteApp pathname=\{window\.location\.pathname\} \/>/)
  assert.doesNotMatch(mainSource, /StaticPublicRouteBootstrap/)
})

test('stored sessions bypass public hydration and mount App from a clean root', () => {
  assert.match(mainSource, /const TOKEN_STORAGE_KEY = 'hireflow_auth_token'/)
  assert.match(mainSource, /function hasStoredAuthenticatedSession\(\) \{[\s\S]*localStorage\.getItem\(TOKEN_STORAGE_KEY\)[\s\S]*catch/)
  assert.match(mainSource, /if \(shouldHydratePrerenderedRoute\) \{\s*root\.replaceChildren\(\)\s*\}/)
  assert.match(mainSource, /ReactDOM\.createRoot\(root\)\.render\([\s\S]*<App \/>/)
})
