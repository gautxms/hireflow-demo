import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('App auth synchronization uses latest-request-wins and aborts older requests', () => {
  assert.match(source, /authSyncSequenceRef = useRef\(0\)/)
  assert.match(source, /authSyncControllerRef = useRef\(null\)/)
  assert.match(source, /authSyncControllerRef\.current\?\.abort\(\)/)
  assert.match(source, /const controller = new AbortController\(\)/)
  assert.match(source, /signal: controller\.signal/)
  assert.match(source, /authSyncSequenceRef\.current === requestId && !controller\.signal\.aborted/)
})

test('App auth synchronization prevents older or obsolete-token responses from committing', () => {
  assert.match(source, /if \(!isLatestAuthSync\(\) \|\| getStoredToken\(\) !== activeToken\) \{\s*return null\s*\}/)
  assert.match(source, /const nextUserProfile = await response\.json\(\)[\s\S]*if \(!isLatestAuthSync\(\) \|\| getStoredToken\(\) !== activeToken\)/)
  assert.match(source, /localStorage\.setItem\('subscription_status', nextSubscriptionStatus\)/)
  assert.match(source, /setSubscriptionStatus\(nextSubscriptionStatus\)/)
  assert.match(source, /setUserProfile\(nextUserProfile \|\| null\)/)
})

test('App auth synchronization ignores expected aborts and aborts during cleanup', () => {
  assert.match(source, /if \(error\?\.name === 'AbortError'\) \{\s*return null\s*\}/)
  assert.match(source, /authSyncControllerRef\.current\?\.abort\(\)/)
})

test('App logout remains the only ordinary path that clears resume analysis results', () => {
  const clearSessionMatch = source.match(/const clearAuthenticatedSession = useCallback\(\([\s\S]*?\n\s{2}\}, \[\]\)/)
  assert.ok(clearSessionMatch)
  assert.match(clearSessionMatch[0], /clearResumeAnalysisResult\(\)/)

  const handleUserProfileUpdateMatch = source.match(/const handleUserProfileUpdate = useCallback\([\s\S]*?\n\s{2}\}, \[\]\)/)
  assert.ok(handleUserProfileUpdateMatch)
  assert.doesNotMatch(handleUserProfileUpdateMatch[0], /clearResumeAnalysisResult\(\)/)
})

test('App stabilizes logout and profile update callbacks and syncs subscription status from profile updates', () => {
  assert.match(source, /const logout = useCallback\(async \(\) => \{\s*clearAuthenticatedSession\(\)/)
  assert.match(source, /const handleUserProfileUpdate = useCallback\(\(nextUserProfile\) => \{/)
  assert.match(source, /if \(nextUserProfile\?\.subscription_status\) \{\s*localStorage\.setItem\('subscription_status', nextUserProfile\.subscription_status\)\s*setSubscriptionStatus\(nextUserProfile\.subscription_status\)/)
})
