import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('public marketing pages resolve from pathname before legacy currentPage fallback', () => {
  assert.match(appSource, /if \(INTENT_PAGE_ORDER\.includes\(resolvedPathname\)\) \{[\s\S]*<IntentLandingPage pathname=\{resolvedPathname\} \/>/)
  assert.match(appSource, /if \(resolvedPathname === '\/help'\) {[\s\S]*return <HelpPage/)
})

test('header features and logo clicks navigate to concrete public pathname', () => {
  const featuresHandler = appSource.match(/const handleFeaturesClick = \(\) => \{([\s\S]*?)\n {2}\}/)
  assert.ok(featuresHandler)
  assert.match(featuresHandler[1], /navigate\('\/'\)/)
  assert.doesNotMatch(featuresHandler[1], /setCurrentPage\(/)

  assert.match(appSource, /site-header__logo/)
  assert.match(appSource, /event\.preventDefault\(\)[\s\S]*navigate\('\/'\)/)
})

test('login-to-landing guard: landing is route-driven and login remains explicit', () => {
  assert.doesNotMatch(appSource, /currentPage === 'landing'/)
  assert.match(appSource, /if \(isRootLandingPath\) \{[\s\S]*<LandingPage/)
  assert.match(appSource, /if \(resolvedPathname === '\/login'\) {[\s\S]*return <LoginPage/)
})


test('logged-out public routes always resolve to concrete non-null content', () => {
  assert.match(appSource, /if \(isRootLandingPath\) \{[\s\S]*<LandingPage/)
  assert.match(appSource, /if \(!isAuthenticated\) {[\s\S]*<LandingPage[\s\S]*ctaLabel="View pricing"/)
})

test('route diagnostics include pathname, resolvedPathname, and matched branch', () => {
  assert.match(appSource, /console\.debug\('\[route-diagnostics\]', \{ pathname, resolvedPathname, matchedBranch \}\)/)
})

test('route matching in getPageContent consistently uses resolvedPathname', () => {
  assert.match(appSource, /if \(getAnalysisDetailRouteId\(resolvedPathname\)\)/)
  assert.match(appSource, /if \(getCandidateDetailRouteId\(resolvedPathname\)\)/)
  assert.doesNotMatch(appSource, /if \(pathname\.startsWith\('\/analyses\/'\)\)/)
  assert.doesNotMatch(appSource, /if \(pathname\.startsWith\('\/candidates\/'\)\)/)
})

test('user shell routing resolves from canonical route paths', () => {
  assert.match(appSource, /function shouldRenderWithinUserShell\([\s\S]*return isUserShellRoutePath\(resolvedPathname\)/)
})

test('authenticated paid and read-only users keep public header and footer on landing route', () => {
  assert.match(appSource, /if \(PUBLIC_ROUTE_PATHS\.has\(pathname\)\) \{[\s\S]*return false/)
  assert.match(appSource, /<header className="site-header">/)
  assert.match(appSource, /<PublicFooter \/>/)
  assert.match(appSource, /canOpenWorkspaceDashboard \? \([\s\S]*Dashboard[\s\S]*\) : \(/)
})

test('dashboard path remains a shell route and unauthenticated users hit auth guard flow', () => {
  assert.match(appSource, /function shouldRenderWithinUserShell\([\s\S]*return isUserShellRoutePath\(resolvedPathname\)/)
  assert.match(appSource, /if \(resolvedPathname === '\/dashboard'\) \{[\s\S]*guardSubscriptionRoute\([\s\S]*authPromptMessage: 'Please login to view the dashboard\.'/)
  assert.match(appSource, /if \(useUserShellLayout\) \{[\s\S]*<UserAppShell/)
})


test('authenticated root path bypasses dashboard alias resolution and stays landing', () => {
  assert.match(appSource, /const isRootLandingPath = pathname === '\/'/)
  assert.match(appSource, /const resolvedPathname = isRootLandingPath \? pathname : resolveUserSectionPath\(pathname\)/)
  assert.match(appSource, /if \(isRootLandingPath\) \{[\s\S]*<LandingPage/)
})



test('landing CTA uses dashboard label and route for paid and read-only Dashboard users', () => {
  assert.match(appSource, /onStartDemo=\{\(\) => \(canOpenWorkspaceDashboard \? navigate\('\/dashboard'\) : navigate\('\/pricing'\)\)\}/)
  assert.match(appSource, /ctaLabel=\{canOpenWorkspaceDashboard \? 'Dashboard' : 'View pricing'\}/)
})

test('landing CTA keeps non-subscribed behavior unchanged', () => {
  assert.match(appSource, /ctaLabel=\{canOpenWorkspaceDashboard \? 'Dashboard' : 'View pricing'\}/)
  assert.doesNotMatch(appSource, /ctaLabel=\{canOpenWorkspaceDashboard \? 'Dashboard' : 'Start demo'\}/)
})

test('dashboard rendering remains explicit to dashboard pathname', () => {
  assert.match(appSource, /if \(resolvedPathname === '\/dashboard'\) \{[\s\S]*<OperationsDashboard/)
})

test('shortlists route stays canonical and authenticated in app routing', () => {
  assert.match(appSource, /if \(resolvedPathname === '\/shortlists'\) \{[\s\S]*guardAuthenticatedRoute\([\s\S]*promptMessage: 'Please login to view shortlists\.'[\s\S]*return <ShortlistsPage isReadOnly=\{!profileBillingState\.canUsePaidMutation\} \/>/)
  assert.doesNotMatch(appSource, /if \(resolvedPathname === '\/shortlists'\) \{[\s\S]*return <CandidatesPage \/>/)
})


test('auth routes render without public marketing chrome', () => {
  assert.match(appSource, /const AUTH_ROUTE_PATHS = new Set\(\[/)
  assert.match(appSource, /const useAuthRouteLayout = AUTH_ROUTE_PATHS\.has\(resolvedPathname\) \|\| resolvedPathname\.startsWith\('\/reset-password\/'\)/)
  assert.match(appSource, /if \(useAuthRouteLayout\) \{[\s\S]*<PageSeo pathname=\{pathname\} currentPage=\{currentPage\} \/>[\s\S]*\{pageContent\}[\s\S]*\}/)
})
