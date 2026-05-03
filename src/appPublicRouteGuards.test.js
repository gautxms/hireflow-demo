import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('public marketing pages resolve from pathname before legacy currentPage fallback', () => {
  assert.match(appSource, /pathname === '\/' || resolvedPathname === '\/ai-resume-screening'/)
  assert.match(appSource, /if \(resolvedPathname === '\/help'\) {[\s\S]*return <HelpPage/)
})

test('header features and logo clicks navigate to concrete public pathname', () => {
  const featuresHandler = appSource.match(/const handleFeaturesClick = \(\) => \{([\s\S]*?)\n  \}/)
  assert.ok(featuresHandler)
  assert.match(featuresHandler[1], /navigate\('\/'\)/)
  assert.doesNotMatch(featuresHandler[1], /setCurrentPage\(/)

  assert.match(appSource, /site-header__logo/)
  assert.match(appSource, /event\.preventDefault\(\)[\s\S]*navigate\('\/'\)/)
})

test('login-to-landing guard: landing is route-driven and login remains explicit', () => {
  assert.doesNotMatch(appSource, /currentPage === 'landing'/)
  assert.match(appSource, /if \(pathname === '\/' || resolvedPathname === '\/ai-resume-screening'\) {[\s\S]*<LandingPage/)
  assert.match(appSource, /if \(pathname === '\/login'\) {[\s\S]*return <LoginPage/)
})
