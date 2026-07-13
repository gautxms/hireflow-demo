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
  const block = source.slice(source.indexOf('useEffect(() => {\n    if (isBlockedPaidWorkspaceRoute)'), source.indexOf('if (isAccessResolving && isProtectedAccessRoute)'))
  const redirectMatches = block.match(/navigate\('\/pricing\?reason=subscription_required', \{ replace: true \}\)/g) || []

  assert.equal(redirectMatches.length, 1)
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

test('login success waits for authoritative auth sync before resolving access', () => {
  const loginBlock = source.slice(source.indexOf('const handleAuthSuccess ='), source.indexOf('const logout = useCallback'))

  assert.match(loginBlock, /setAccessResolution\(\{ status: 'resolving', error: '' \}\)/)
  assert.doesNotMatch(loginBlock, /setAccessResolution\(\{ status: 'resolved'/)
  assert.match(loginBlock, /void syncAuthenticatedUser\(\)/)
})

test('token storage changes start latest authenticated sync for non-empty replacement tokens', () => {
  const storageBlock = source.slice(source.indexOf('const onStorage ='), source.indexOf("if (event.key === USER_STORAGE_KEY)"))

  assert.match(storageBlock, /setToken\(event\.newValue \|\| ''\)/)
  assert.match(storageBlock, /setAccessResolution\(\{ status: event\.newValue \? 'resolving' : 'resolved', error: '' \}\)/)
  assert.match(storageBlock, /if \(event\.newValue\) \{\s*void syncAuthenticatedUser\(\)\s*\}/)
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
