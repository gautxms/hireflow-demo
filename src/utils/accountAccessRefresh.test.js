import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ACCOUNT_ACCESS_REFRESH_EVENT,
  isSubscriptionAccessDenied,
  notifySubscriptionAccessDenied,
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

test('authenticated access refresh runs periodically only while the page is visible and cleans up', () => {
  assert.match(appSource, /ACCOUNT_ACCESS_REFRESH_INTERVAL_MS/)
  assert.match(appSource, /const shouldSchedulePeriodicAccessRefresh = isPaidWorkspaceRoutePath\(accessRefreshPathname\)[\s\S]*isReadOnlyWorkspaceFrontendRoute\(accessRefreshPathname\)/)
  assert.match(appSource, /window\.setInterval\(refreshAccountAccessSilently, ACCOUNT_ACCESS_REFRESH_INTERVAL_MS\)/)
  assert.match(appSource, /if \(document\.visibilityState !== 'visible'\) \{\s*stopPeriodicAccessRefresh\(\)/)
  assert.match(appSource, /window\.clearInterval\(accessRefreshIntervalId\)/)
  assert.match(appSource, /window\.addEventListener\(ACCOUNT_ACCESS_REFRESH_EVENT, refreshAccountAccessSilently\)/)
  assert.match(appSource, /window\.removeEventListener\(ACCOUNT_ACCESS_REFRESH_EVENT, refreshAccountAccessSilently\)/)
})

test('silent account refresh failures preserve the current shell instead of forcing a blocking error', () => {
  const syncBlock = appSource.slice(
    appSource.indexOf('const syncAuthenticatedUser = useCallback'),
    appSource.indexOf('useEffect(() => {', appSource.indexOf('const syncAuthenticatedUser = useCallback')),
  )

  assert.match(syncBlock, /if \(showLoading && isLatestAuthSync\(\) && getStoredToken\(\) === activeToken\)/)
})

test('job mutations request an immediate authoritative refresh after a subscription denial', () => {
  assert.match(jobsSource, /notifySubscriptionAccessDenied/)
  assert.equal(jobsSource.split('notifySubscriptionAccessDenied(response, payload)').length - 1, 2)
  assert.equal(ACCOUNT_ACCESS_REFRESH_EVENT, 'hireflow-account-access-refresh')
})
