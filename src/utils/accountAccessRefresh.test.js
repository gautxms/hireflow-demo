import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ACCOUNT_ACCESS_REFRESH_EVENT,
  ACCOUNT_ACCESS_REFRESH_INTERVAL_MS,
  ACCOUNT_ACCESS_REFRESH_WAKEUP_RECHECK_MS,
  getAccountAccessPollingStartDelay,
  isSubscriptionAccessDenied,
  notifySubscriptionAccessDenied,
  shouldPollAccountAccess,
} from './accountAccessRefresh.js'

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const jobsSource = readFileSync(new URL('../pages/JobDescriptionPage.jsx', import.meta.url), 'utf8')

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

test('periodic access polling is limited to paid-access accounts near an access boundary', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z')

  assert.equal(ACCOUNT_ACCESS_REFRESH_INTERVAL_MS, 2 * 60 * 1000)
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
  assert.match(appSource, /window\.addEventListener\(ACCOUNT_ACCESS_REFRESH_EVENT, refreshAccountAccessSilently\)/)
  assert.match(appSource, /window\.removeEventListener\(ACCOUNT_ACCESS_REFRESH_EVENT, refreshAccountAccessSilently\)/)
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
  const silentGuardIndex = syncBlock.indexOf('if (!showLoading && authSyncControllerRef.current)')
  const abortIndex = syncBlock.indexOf('authSyncControllerRef.current?.abort()')

  assert.notEqual(silentGuardIndex, -1)
  assert.ok(silentGuardIndex < abortIndex)
  assert.match(syncBlock, /if \(!showLoading && authSyncControllerRef\.current\) \{\s*authSyncFollowUpRequestedRef\.current = true\s*return null\s*\}/)
})

test('silent refresh requests coalesce behind an in-flight authoritative sync', () => {
  const syncBlock = appSource.slice(
    appSource.indexOf('const syncAuthenticatedUser = useCallback'),
    appSource.indexOf('useEffect(() => {', appSource.indexOf('const syncAuthenticatedUser = useCallback')),
  )

  assert.match(appSource, /authSyncFollowUpRequestedRef = useRef\(false\)/)
  assert.match(syncBlock, /if \(!showLoading && authSyncControllerRef\.current\) \{\s*authSyncFollowUpRequestedRef\.current = true\s*return null\s*\}/)
  assert.match(syncBlock, /if \(authSyncFollowUpRequestedRef\.current\) \{\s*authSyncFollowUpRequestedRef\.current = false\s*void syncAuthenticatedUser\(\{ showLoading: false \}\)\s*\}/)
})

test('job mutations request an immediate authoritative refresh after a subscription denial', () => {
  assert.match(jobsSource, /notifySubscriptionAccessDenied/)
  assert.equal(jobsSource.split('notifySubscriptionAccessDenied(response, payload)').length - 1, 2)
  assert.equal(ACCOUNT_ACCESS_REFRESH_EVENT, 'hireflow-account-access-refresh')
})
