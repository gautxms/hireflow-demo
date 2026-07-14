import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('paid route block is decided before page content construction', () => {
  const blockedIndex = source.indexOf('if (isBlockedPaidWorkspaceRoute)')
  const pageContentIndex = source.indexOf('const pageContent = (')
  const getPageContentIndex = source.indexOf('{getPageContent()}')

  assert.ok(blockedIndex > -1)
  assert.ok(pageContentIndex > -1)
  assert.ok(getPageContentIndex > pageContentIndex)
  assert.ok(blockedIndex < pageContentIndex)
})

test('blocked paid route uses exactly one replace navigation to subscription pricing', () => {
  const blockStart = source.indexOf('if (isBlockedPaidWorkspaceRoute)')
  const block = source.slice(blockStart, source.indexOf('if (normalizedLegacyAccountPath)', blockStart))
  const redirectMatches = block.match(/navigate\('\/pricing\?reason=subscription_required', \{ replace: true \}\)/g) || []

  assert.equal(redirectMatches.length, 1)
})

test('only staged historical Jobs, Analyses, Candidates, and Shortlists routes are opened by the read-only shell', () => {
  assert.match(source, /const READ_ONLY_WORKSPACE_FRONTEND_ROUTES = new Set\(\['\/job-descriptions', '\/analyses', '\/candidates', '\/shortlists'\]\)/)
  assert.match(source, /READ_ONLY_WORKSPACE_FRONTEND_ROUTES\.has\(resolvedPathname\)[\s\S]*canAccessRouteForSubscriptionState\(resolvedPathname, subscriptionStateOrStatus\)/)
  assert.match(source, /const hasReadOnlyWorkspaceRouteAccess = [\s\S]*READ_ONLY_WORKSPACE_FRONTEND_ROUTES\.has\(resolvedPathname\)[\s\S]*canAccessRouteForSubscriptionState\(resolvedPathname, profileBillingState\)/)
  assert.match(source, /isPaidWorkspaceRoutePath\(resolvedPathname\)[\s\S]*&& !hasReadOnlyWorkspaceRouteAccess/)
  assert.match(source, /<JobDescriptionPage[\s\S]*isReadOnly=\{!profileBillingState\.canUsePaidMutation\}/)
  assert.match(source, /<AnalysesPage isReadOnly=\{!profileBillingState\.canUsePaidMutation\} \/>/)
  assert.match(source, /<CandidatesPage isReadOnly=\{!profileBillingState\.canUsePaidMutation\} \/>/)
  assert.match(source, /<ShortlistsPage isReadOnly=\{!profileBillingState\.canUsePaidMutation\} \/>/)
})

test('blocked guards return before page evaluation can run fallbacks or intent mutation paths', () => {
  const blockedIndex = source.indexOf('if (isBlockedPaidWorkspaceRoute)')
  const blockedReturn = source.indexOf('Checking workspace access', blockedIndex)
  const pageContentIndex = source.indexOf('const pageContent = (')
  const getPageContentIndex = source.indexOf('{getPageContent()}', pageContentIndex)

  assert.ok(blockedIndex < blockedReturn)
  assert.ok(blockedReturn < pageContentIndex)
  assert.ok(pageContentIndex < getPageContentIndex)
  assert.match(source, /navigate\('\/results'\)/)
  assert.match(source, /navigate\('\/dashboard\/legacy'\)/)
  assert.match(source, /allowed: consumeCreateAnalysisIntent\(\)/)
  assert.match(source, /handleCreateAnalysis\(\)/)
})

test('access resolution has resolving, resolved, error, retry, and latest-request guards', () => {
  assert.match(source, /status: getStoredToken\(\) \? 'resolving' : 'resolved'/)
  assert.match(source, /setAccessResolution\(\{ status: 'resolving', error: '' \}\)/)
  assert.match(source, /setAccessResolution\(\{ status: 'resolved', error: '' \}\)/)
  assert.match(source, /setAccessResolution\(\{ status: 'error'/)
  assert.match(source, /onRetryAccessResolution=\{\(\) => \{ void syncAuthenticatedUser\(\) \}\}/)
  assert.match(source, /authSyncSequenceRef\.current === requestId && !controller\.signal\.aborted/)
})

test('historical detail routes do not run module-flag fallback redirects', () => {
  const analysisDetailBlock = source.slice(source.indexOf("if (resolvedPathname.startsWith('/analyses/'))"), source.indexOf("if (resolvedPathname === '/candidates')"))
  const candidateDetailBlock = source.slice(source.indexOf("if (resolvedPathname.startsWith('/candidates/'))"), source.indexOf("if (resolvedPathname === '/job-descriptions')"))

  assert.doesNotMatch(analysisDetailBlock, /navigate\('\/results'\)/)
  assert.doesNotMatch(candidateDetailBlock, /navigate\('\/results'\)/)
})

test('login success waits for authoritative auth-state effect before resolving access', () => {
  const loginBlock = source.slice(source.indexOf('const handleAuthSuccess ='), source.indexOf('const logout = useCallback'))

  assert.match(loginBlock, /setAccessResolution\(\{ status: 'resolving', error: '' \}\)/)
  assert.doesNotMatch(loginBlock, /setAccessResolution\(\{ status: 'resolved'/)
  assert.doesNotMatch(loginBlock, /void syncAuthenticatedUser\(\)/)
})

test('token storage changes start latest authenticated sync for non-empty replacement tokens', () => {
  const storageBlock = source.slice(source.indexOf('const onStorage ='), source.indexOf("if (event.key === USER_STORAGE_KEY)"))

  assert.match(storageBlock, /setToken\(event\.newValue \|\| ''\)/)
  assert.match(storageBlock, /setAccessResolution\(\{ status: event\.newValue && !isStandaloneOrdinaryUserAuthRoutePath\(pathname\) \? 'resolving' : 'resolved', error: '' \}\)/)
  assert.match(storageBlock, /if \(event\.newValue && !isStandaloneOrdinaryUserAuthRoutePath\(pathname\)\) \{\s*void syncAuthenticatedUser\(\)\s*\}/)
})

test('resolving access holds public shell decisions and pricing redirects', () => {
  assert.match(source, /const shouldHoldForAccessResolution = isAuthenticated && !isStandaloneDuringAccessResolution/)
  assert.match(source, /if \(isAccessResolving && shouldHoldForAccessResolution\)/)
  assert.match(source, /if \(isAuthenticated && isAccessAuthoritative && isActiveSubscriber\)/)
  assert.match(source, /buildResolvedAccessContext\(\{/)
})

test('legacy account alias uses replace navigation before shell content construction', () => {
  const legacyEffect = source.slice(source.indexOf('const normalizedLegacyAccountPath'), source.indexOf('const getPageContent ='))
  const legacyReturnStart = source.indexOf('if (normalizedLegacyAccountPath)', source.indexOf('const isBlockedPaidWorkspaceRoute'))
  const legacyReturn = source.slice(legacyReturnStart, source.indexOf('if (isAccessResolving && shouldHoldForAccessResolution)'))

  assert.match(legacyEffect, /navigate\(normalizedLegacyAccountPath, \{ replace: true \}\)/)
  assert.match(legacyReturn, /Opening account settings/)
  assert.doesNotMatch(legacyReturn, /UserAppShell|AuthenticatedAccountShell/)
})

test('landing dashboard CTA depends on authenticated active subscriber context, not stale logged-out profile data', () => {
  const landingBlock = source.slice(source.indexOf("if (isRootLandingPath)"), source.indexOf("if (resolvedPathname === '/pricing')"))

  assert.match(landingBlock, /ctaLabel=\{isActiveSubscriber \? 'Dashboard' : 'View pricing'\}/)
  assert.match(source, /buildResolvedAccessContext\(\{/)
})

test('standalone routes bypass ordinary user auth sync side effects', () => {
  const syncStart = source.slice(source.indexOf('const syncAuthenticatedUser = useCallback'), source.indexOf("setAccessResolution({ status: 'resolving'") )
  const storageBlock = source.slice(source.indexOf('const onStorage ='), source.indexOf("if (event.key === USER_STORAGE_KEY)"))
  const authUpdatedBlock = source.slice(source.indexOf('const onAuthStateRefresh ='), source.indexOf('const onStorage ='))
  const focusBlock = source.slice(source.indexOf('const handleWindowFocus ='), source.indexOf("window.addEventListener('focus'") )

  assert.match(syncStart, /isStandaloneOrdinaryUserAuthRoutePath\(pathname\)/)
  assert.match(storageBlock, /event\.newValue && !isStandaloneOrdinaryUserAuthRoutePath\(pathname\)/)
  assert.match(authUpdatedBlock, /!isStandaloneOrdinaryUserAuthRoutePath\(pathname\)/)
  assert.match(focusBlock, /!isStandaloneOrdinaryUserAuthRoutePath\(pathname\)/)
})


test('focus and visibility account refreshes are silent after the initial access gate', () => {
  const focusBlock = source.slice(source.indexOf('const handleWindowFocus ='), source.indexOf("window.addEventListener('focus'"))
  const syncSignatureBlock = source.slice(source.indexOf('const syncAuthenticatedUser = useCallback'), source.indexOf('const activeToken = getStoredToken()'))

  assert.match(syncSignatureBlock, /showLoading = true/)
  assert.match(source, /if \(showLoading\) \{\s*setAccessResolution\(\{ status: 'resolving', error: '' \}\)\s*\}/)
  assert.match(focusBlock, /syncAuthenticatedUser\(\{ showLoading: false \}\)/)
  assert.doesNotMatch(focusBlock, /void syncAuthenticatedUser\(\)\s*\}/)
})

test('login success relies on auth-state effect for a single authoritative sync trigger', () => {
  const loginBlock = source.slice(source.indexOf('const handleAuthSuccess ='), source.indexOf('const logout = useCallback'))

  assert.match(loginBlock, /setAccessResolution\(\{ status: 'resolving', error: '' \}\)/)
  assert.doesNotMatch(loginBlock, /void syncAuthenticatedUser\(\)/)
  assert.match(source, /useEffect\(\(\) => \{\s*if \(!isAuthenticated \|\| isStandaloneOrdinaryUserAuthRoutePath\(pathname\)\)/)
})

test('canonical detail helpers gate detail rendering instead of broad prefixes', () => {
  assert.match(source, /if \(getAnalysisDetailRouteId\(resolvedPathname\)\)/)
  assert.match(source, /if \(getCandidateDetailRouteId\(resolvedPathname\)\)/)
  assert.doesNotMatch(source, /resolvedPathname\.startsWith\('\/analyses\/'\)/)
  assert.doesNotMatch(source, /resolvedPathname\.startsWith\('\/candidates\/'\)/)
})
