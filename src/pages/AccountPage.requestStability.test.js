import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./AccountPage.jsx', import.meta.url), 'utf8')

test('AccountPage starts exactly one auth and one subscription request per refresh batch', () => {
  assert.match(source, /Promise\.allSettled\(\[\s*fetch\(`\$\{API_BASE\}\/auth\/me`/)
  assert.match(source, /fetch\(`\$\{API_BASE\}\/subscriptions\/current`/)
})

test('AccountPage uses latest-request-wins sequencing and aborts replaced requests', () => {
  assert.match(source, /requestSequenceRef = useRef\(0\)/)
  assert.match(source, /activeRequestControllerRef = useRef\(null\)/)
  assert.match(source, /activeRequestControllerRef\.current\?\.abort\(\)/)
  assert.match(source, /const controller = new AbortController\(\)/)
  assert.match(source, /requestSequenceRef\.current = requestId/)
  assert.match(source, /requestSequenceRef\.current === requestId && !controller\.signal\.aborted/)
})

test('AccountPage sends abort signals to both initial requests and aborts on unmount', () => {
  assert.match(source, /signal: controller\.signal,[\s\S]*fetch\(`\$\{API_BASE\}\/subscriptions\/current`/)
  assert.match(source, /return \(\) => \{\s*activeRequestControllerRef\.current\?\.abort\(\)/)
})

test('AccountPage treats AbortError as expected control flow without warning', () => {
  assert.match(source, /function isAbortError\(error\)/)
  assert.match(source, /if \(isAbortError\(userResult\.reason\)\) return/)
  assert.match(source, /if \(isAbortError\(subscriptionResult\.reason\)\) return/)
  assert.match(source, /if \(isAbortError\(err\) \|\| !isLatestRequest\(requestId, controller\)\)/)
})

test('AccountPage only latest non-aborted request can commit state or parent profile updates', () => {
  assert.match(source, /if \(!isLatestRequest\(requestId, controller\)\) \{\s*return\s*\}/)
  assert.match(source, /onUserProfileUpdateRef\.current\?\.\(normalizedUser\)/)
  assert.match(source, /if \(isLatestRequest\(requestId, controller\)\) \{\s*setRefreshWarning\(nextWarning\)\s*setLoading\(false\)/)
})

test('AccountPage preserves displayable subscription data during same-account refresh and failed partial responses', () => {
  assert.match(source, /if \(!didAuthenticatedScopeChange\) \{\s*setFatalError\(''\)\s*setRefreshWarning\(''\)\s*\}/)
  assert.match(source, /setSubscriptionData\(subscriptionPayload\.subscription \|\| null\)/)
  assert.match(source, /nextWarning = 'We could not refresh subscription details\. Showing the safest available account view\.'/)
})

test('AccountPage clears subscription data immediately when authenticated account scope changes', () => {
  assert.match(source, /const nextAuthenticatedScope = `\$\{token\}:\$\{getUserKey\(currentUser\)\}`/)
  assert.match(source, /const didAuthenticatedScopeChange = authenticatedScopeRef\.current !== nextAuthenticatedScope/)
  assert.match(source, /if \(didAuthenticatedScopeChange\) \{[\s\S]*setSubscriptionData\(null\)/)
  assert.match(source, /if \(didAuthenticatedScopeChange\) \{[\s\S]*requestSequenceRef\.current \+= 1/)
})

test('AccountPage account or token changes cannot render previous account subscription while fetching', () => {
  assert.match(source, /authenticatedScopeRef = useRef\(''\)/)
  assert.match(source, /activeRequestControllerRef\.current\?\.abort\(\)[\s\S]*requestSequenceRef\.current \+= 1[\s\S]*setSubscriptionData\(null\)/)
  assert.match(source, /fetchUserData\(\{ isInitialLoad: didAuthenticatedScopeChange \}\)/)
})

test('AccountPage stable refs prevent callback rerenders from retriggering initial loading', () => {
  assert.match(source, /onLogoutRef = useRef\(onLogout\)/)
  assert.match(source, /onUserProfileUpdateRef = useRef\(onUserProfileUpdate\)/)
  assert.match(source, /useEffect\(\(\) => \{\s*onUserProfileUpdateRef\.current = onUserProfileUpdate/)
  assert.match(source, /\}, \[handleExpiredSession, isLatestRequest, token\]\)/)
  assert.doesNotMatch(source, /\}, \[handleExpiredSession, onUserProfileUpdate, token\]\)/)
})

test('AccountPage stale 401 cannot log out after a newer request supersedes it', () => {
  assert.match(source, /if \(!isLatestRequest\(requestId, controller\)\) \{\s*return\s*\}[\s\S]*if \(userResponse\.status === 401\)/)
  assert.match(source, /if \(!isLatestRequest\(requestId, controller\)\) \{\s*return\s*\}[\s\S]*if \(subscriptionResponse\.status === 401\)/)
})
