import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mainSource = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8')
const bootstrapSource = readFileSync(new URL('./public/StaticPublicRouteBootstrap.jsx', import.meta.url), 'utf8')

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
