import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('public marketing pages resolve from pathname before legacy currentPage fallback', () => {
  assert.match(appSource, /resolvedPathname === '\/' \|\| resolvedPathname === '\/ai-resume-screening'/)
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
  assert.match(appSource, /if \(isRootLandingPath \|\| resolvedPathname === '\/ai-resume-screening'\) \{[\s\S]*<LandingPage/)
  assert.match(appSource, /if \(resolvedPathname === '\/login'\) {[\s\S]*return <LoginPage/)
})


test('logged-out public routes always resolve to concrete non-null content', () => {
  assert.match(appSource, /if \(isRootLandingPath \|\| resolvedPathname === '\/ai-resume-screening'\) \{[\s\S]*<LandingPage/)
  assert.match(appSource, /if \(!isAuthenticated\) {[\s\S]*<LandingPage[\s\S]*ctaLabel="View pricing"/)
})

test('route diagnostics include pathname, resolvedPathname, and matched branch', () => {
  assert.match(appSource, /console\.debug\('\[route-diagnostics\]', \{ pathname, resolvedPathname, matchedBranch \}\)/)
})

test('route matching in getPageContent consistently uses resolvedPathname', () => {
  assert.match(appSource, /if \(resolvedPathname\.startsWith\('\/analyses\/'\)\)/)
  assert.match(appSource, /if \(resolvedPathname\.startsWith\('\/candidates\/'\)\)/)
  assert.doesNotMatch(appSource, /if \(pathname\.startsWith\('\/analyses\/'\)\)/)
  assert.doesNotMatch(appSource, /if \(pathname\.startsWith\('\/candidates\/'\)\)/)
})

test('user shell route paths include app destinations and exclude public pages', () => {
  const shellRoutesMatch = appSource.match(/const USER_SHELL_ROUTE_PATHS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(shellRoutesMatch)
  const shellRoutesBlock = shellRoutesMatch[1]

  assert.match(shellRoutesBlock, /'\/dashboard'/)
  assert.match(shellRoutesBlock, /'\/settings'/)
  assert.doesNotMatch(shellRoutesBlock, /'\/'/)
  assert.doesNotMatch(shellRoutesBlock, /'\/pricing'/)
})

test('authenticated subscribed users keep public header and footer on landing route', () => {
  assert.match(appSource, /if \(PUBLIC_ROUTE_PATHS\.has\(pathname\)\) \{[\s\S]*return false/)
  assert.match(appSource, /<header className="site-header">/)
  assert.match(appSource, /<PublicFooter \/>/)
  assert.match(appSource, /isActiveSubscriber \? \([\s\S]*Dashboard[\s\S]*\) : \(/)
})

test('dashboard path remains a shell route and unauthenticated users hit auth guard flow', () => {
  assert.match(appSource, /const USER_SHELL_ROUTE_PATHS = new Set\(\[[\s\S]*'\/dashboard'[\s\S]*\]\)/)
  assert.match(appSource, /if \(resolvedPathname === '\/dashboard'\) \{[\s\S]*guardAuthenticatedRoute\([\s\S]*promptMessage: 'Please login to view the dashboard\.'/)
  assert.match(appSource, /if \(useUserShellLayout\) \{[\s\S]*<UserAppShell/)
})


test('authenticated root path bypasses dashboard alias resolution and stays landing', () => {
  assert.match(appSource, /const isRootLandingPath = pathname === '\/'/)
  assert.match(appSource, /const resolvedPathname = isRootLandingPath \? pathname : \(isAuthenticated \? resolveUserSectionPath\(pathname\) : pathname\)/)
  assert.match(appSource, /if \(isRootLandingPath \|\| resolvedPathname === '\/ai-resume-screening'\) \{[\s\S]*<LandingPage/)
})



test('landing CTA sends active subscribers to explicit dashboard path', () => {
  assert.match(appSource, /onStartDemo=\{\(\) => \(isActiveSubscriber \? navigate\('\/dashboard'\) : navigate\('\/pricing'\)\)\}/)
})
test('dashboard rendering remains explicit to dashboard pathname', () => {
  assert.match(appSource, /if \(resolvedPathname === '\/dashboard'\) \{[\s\S]*<OperationsDashboard/)
})
