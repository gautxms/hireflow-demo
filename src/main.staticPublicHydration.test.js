import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldHydrateStaticPublicRoute } from './public/staticPublicRouteHydration.js'

const mainSource = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8')
const bootstrapSource = readFileSync(new URL('./public/StaticPublicRouteBootstrap.jsx', import.meta.url), 'utf8')

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
  assert.match(mainSource, /if \(shouldHydratePrerenderedRoute\)/)
  assert.doesNotMatch(mainSource, /if \(root\.hasAttribute\('data-static-public-route'\)\)/)
})

test('static public routes preserve prerendered markup for hydration before mounting App', () => {
  assert.match(bootstrapSource, /return createElement\(PublicRouteComponent, \{ pathname \}\)/)
  assert.match(mainSource, /hydrateRoot\([\s\S]*<StaticPublicRouteBootstrap[\s\S]*PublicRouteComponent=\{PublicRouteApp\}[\s\S]*pathname=\{window\.location\.pathname\}/)
})

test('static public routes switch to the auth-aware App after hydration', () => {
  assert.match(bootstrapSource, /useSyncExternalStore\(subscribe, getClientSnapshot, getServerSnapshot\)/)
  assert.match(bootstrapSource, /const getServerSnapshot = \(\) => false/)
  assert.match(bootstrapSource, /const getClientSnapshot = \(\) => true/)
  assert.match(bootstrapSource, /if \(showAuthenticatedApp\) \{\s*return <App \/>\s*\}/)
})
