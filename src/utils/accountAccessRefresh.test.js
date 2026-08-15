import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ACCOUNT_ACCESS_REFRESH_EVENT,
  ACCOUNT_ACCESS_REFRESH_INTERVAL_MS,
  ACCOUNT_ACCESS_REFRESH_POST_BOUNDARY_WINDOW_MS,
  ACCOUNT_ACCESS_REFRESH_WAKEUP_RECHECK_MS,
  fetchWithAccountAccessRefresh,
  getAccountAccessPollingStartDelay,
  isSubscriptionAccessDenied,
  notifySubscriptionAccessDenied,
  shouldPollAccountAccess,
} from './accountAccessRefresh.js'

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const jobsSource = readFileSync(new URL('../pages/JobDescriptionPage.jsx', import.meta.url), 'utf8')
const paidWorkflowSources = [
  '../pages/ReportsPage.jsx',
  '../pages/ShortlistsPage.jsx',
  '../components/AddToShortlistModal.jsx',
  '../components/CandidateResults.jsx',
  '../pages/AnalysesPage.jsx',
  '../components/ResumeUploader.jsx',
  './resumeQuotaPreflight.js',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))

test('subscription access denial is narrowly identified from the paid-mutation response contract', () => {
  assert.equal(isSubscriptionAccessDenied({ status: 403 }, { error: 'Subscription inactive' }), true)
  assert.equal(isSubscriptionAccessDenied({ status: 403 }, { code: 'SUBSCRIPTION_INACTIVE' }), true)
  assert.equal(isSubscriptionAccessDenied({ status: 403 }, { error: 'Forbidden' }), false)
  assert.equal(isSubscriptionAccessDenied({ status: 429 }, { error: 'Subscription inactive' }), false)
})

test('subscription denial emits one refresh event without consuming or changing the response', () => {
  const events = []
  const eventTarget = { dispatchEvent: (event) => events.push(event.type) }
  const response = { status: 403 }

  assert.equal(notifySubscriptionAccessDenied(response, { error: 'Subscription inactive' }, eventTarget), true)
  assert.deepEqual(events, [ACCOUNT_ACCESS_REFRESH_EVENT])
  assert.equal(response.status, 403)
  assert.equal(notifySubscriptionAccessDenied(response, { error: 'Forbidden' }, eventTarget), false)
  assert.deepEqual(events, [ACCOUNT_ACCESS_REFRESH_EVENT])
})

test('shared paid-workflow fetch preserves the response and emits access invalidation once', async () => {
  const events = []
  const eventTarget = { dispatchEvent: (event) => events.push(event.type) }
  const deniedResponse = new Response(JSON.stringify({ error: 'Subscription inactive' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })

  const returnedResponse = await fetchWithAccountAccessRefresh('/api/reports', { method: 'POST' }, {
    fetchImpl: async () => deniedResponse,
    eventTarget,
  })

  assert.equal(returnedResponse, deniedResponse)
  assert.deepEqual(events, [ACCOUNT_ACCESS_REFRESH_EVENT])
  assert.deepEqual(await returnedResponse.json(), { error: 'Subscription inactive' })
})

test('periodic access polling is limited to paid-access accounts near an access boundary', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z')

  assert.equal(ACCOUNT_ACCESS_REFRESH_INTERVAL_MS, 2 * 60 * 1000)
  assert.equal(ACCOUNT_ACCESS_REFRESH_POST_BOUNDARY_WINDOW_MS, 3 * 60 * 60 * 1000)
  assert.equal(ACCOUNT_ACCESS_REFRESH_WAKEUP_RECHECK_MS, 24 * 60 * 60 * 1000)
  assert.equal(shouldPollAccountAccess({ current_period_end: '2026-08-01T12:35:00.000Z' }, 'trialing', now), true)
  assert.equal(shouldPollAccountAccess({ next_billing_date: '2026-08-01T10:30:00.000Z' }, 'active', now), true)
  assert.equal(shouldPollAccountAccess({ cancellation_effective_at: '2026-08-01T12:35:00.000Z' }, 'canceled', now), true)
  assert.equal(shouldPollAccountAccess({ cancellationEffectiveAt: '2026-08-01T13:00:00.000Z' }, 'cancelled', now), true)
  for (const status of ['cancel_scheduled', 'cancellation_scheduled', 'pending_cancellation', 'scheduled_cancellation']) {
    assert.equal(shouldPollAccountAccess({ cancellation_effective_at: '2026-08-01T13:00:00.000Z' }, status, now), true)
  }
  assert.equal(shouldPollAccountAccess({ subscription_renewal_date: '2026-09-01T12:00:00.000Z' }, 'active', now), false)
  assert.equal(shouldPollAccountAccess({ current_period_end: '2026-08-01T12:35:00.000Z' }, 'past_due', now), false)
  assert.equal(shouldPollAccountAccess({}, 'active', now), false)
  assert.equal(getAccountAccessPollingStartDelay({ current_period_end: '2026-08-02T12:00:00.000Z' }, 'active', now), 22 * 60 * 60 * 1000)
  assert.equal(getAccountAccessPollingStartDelay({ cancellation_effective_at: '2026-08-02T12:00:00.000Z' }, 'canceled', now), 22 * 60 * 60 * 1000)
  assert.equal(shouldPollAccountAccess({ current_period_end: '2026-08-01T09:30:00.000Z' }, 'active', now), true)
  assert.equal(shouldPollAccountAccess({ current_period_end: '2026-08-01T08:30:00.000Z' }, 'active', now), false)
  assert.equal(getAccountAccessPollingStartDelay({ current_period_end: '2026-08-01T08:00:00.000Z' }, 'active', now), null)
})

test('authenticated access refresh runs periodically only while the page is visible and cleans up', () => {
  const refreshEffect = appSource.slice(
    appSource.indexOf('let accessRefreshIntervalId = null'),
    appSource.indexOf("// Authenticated users are intentionally redirected away from auth forms"),
  )

  assert.match(appSource, /ACCOUNT_ACCESS_REFRESH_INTERVAL_MS/)
  assert.match(appSource, /const isPeriodicAccessRefreshRoute = \([\s\S]*isPaidWorkspaceRoutePath\(accessRefreshPathname\)[\s\S]*isReadOnlyWorkspaceFrontendRoute\(accessRefreshPathname\)/)
  assert.match(appSource, /window\.setInterval\(runPeriodicAccessRefresh, ACCOUNT_ACCESS_REFRESH_INTERVAL_MS\)/)
  assert.match(appSource, /window\.setTimeout\([\s\S]*scheduleAccessRefreshWakeUp,[\s\S]*Math\.min\(startDelay, ACCOUNT_ACCESS_REFRESH_WAKEUP_RECHECK_MS\)/)
  assert.match(appSource, /window\.clearTimeout\(accessRefreshWakeUpTimeoutId\)/)
  assert.match(appSource, /if \(document\.visibilityState !== 'visible'\) \{\s*stopPeriodicAccessRefresh\(\)/)
  assert.match(appSource, /window\.clearInterval\(accessRefreshIntervalId\)/)
  assert.match(appSource, /window\.addEventListener\(ACCOUNT_ACCESS_REFRESH_EVENT, refreshAccountAccessAfterInvalidation\)/)
  assert.match(appSource, /window\.removeEventListener\(ACCOUNT_ACCESS_REFRESH_EVENT, refreshAccountAccessAfterInvalidation\)/)
  assert.doesNotMatch(refreshEffect, /authSyncControllerRef\.current\?\.abort\(\)/)
})

test('silent account refresh failures preserve the current shell instead of forcing a blocking error', () => {
  const syncBlock = appSource.slice(
    appSource.indexOf('const syncAuthenticatedUser = useCallback'),
    appSource.indexOf('useEffect(() => {', appSource.indexOf('const syncAuthenticatedUser = useCallback')),
  )

  assert.match(syncBlock, /if \(showLoading && isLatestAuthSync\(\) && getStoredToken\(\) === activeToken\)/)
})

test('silent refresh cannot interrupt an in-flight initial access gate', () => {
  const syncBlock = appSource.slice(
    appSource.indexOf('const syncAuthenticatedUser = useCallback'),
    appSource.indexOf('useEffect(() => {', appSource.indexOf('const syncAuthenticatedUser = useCallback')),
  )
  const silentGuardIndex = syncBlock.indexOf('if (!showLoading && authSyncControllerRef.current && !replaceIfBusy)')
  const abortIndex = syncBlock.indexOf('authSyncControllerRef.current?.abort()')

  assert.notEqual(silentGuardIndex, -1)
  assert.ok(silentGuardIndex < abortIndex)
  assert.match(syncBlock, /if \(!showLoading && authSyncControllerRef\.current && !replaceIfBusy\) \{\s*if \(queueIfBusy\) \{\s*authSyncFollowUpRequestedRef\.current = true\s*\}\s*return null\s*\}/)
})

test('explicit invalidation coalesces behind a busy sync without replaying passive refreshes', () => {
  const syncBlock = appSource.slice(
    appSource.indexOf('const syncAuthenticatedUser = useCallback'),
    appSource.indexOf('useEffect(() => {', appSource.indexOf('const syncAuthenticatedUser = useCallback')),
  )

  assert.match(appSource, /authSyncFollowUpRequestedRef = useRef\(false\)/)
  assert.match(syncBlock, /if \(!showLoading && authSyncControllerRef\.current && !replaceIfBusy\) \{\s*if \(queueIfBusy\) \{\s*authSyncFollowUpRequestedRef\.current = true\s*\}\s*return null\s*\}/)
  assert.match(appSource, /syncAuthenticatedUser\(\{ showLoading: false, queueIfBusy: true \}\)/)
  assert.match(appSource, /const handleWindowFocus = \(\) => \{\s*refreshAccountAccessSilently\(\)\s*\}/)
})

test('queued invalidation is dropped after navigation to a standalone route', () => {
  const syncBlock = appSource.slice(
    appSource.indexOf('const syncAuthenticatedUser = useCallback'),
    appSource.indexOf('useEffect(() => {', appSource.indexOf('const syncAuthenticatedUser = useCallback')),
  )

  assert.match(syncBlock, /if \(authSyncFollowUpRequestedRef\.current\) \{\s*authSyncFollowUpRequestedRef\.current = false\s*if \(!isStandaloneOrdinaryUserAuthRoutePath\(window\.location\.pathname\)\) \{\s*void syncAuthenticatedUser\(\{ showLoading: false \}\)\s*\}\s*\}/)
})

test('paid workflow requests use the shared access-refresh response layer', () => {
  for (const source of [jobsSource, ...paidWorkflowSources]) {
    assert.match(source, /fetchWithAccountAccessRefresh/)
    assert.doesNotMatch(source, /\bfetch\(/)
  }
  assert.equal(ACCOUNT_ACCESS_REFRESH_EVENT, 'hireflow-account-access-refresh')
})
