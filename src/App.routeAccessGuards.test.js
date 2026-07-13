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

