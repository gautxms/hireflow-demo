import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('authenticated root route stays route-driven and does not alias to dashboard', () => {
  assert.match(appSource, /const isRootLandingPath = pathname === '\/'/)
  assert.match(appSource, /const resolvedPathname = isRootLandingPath \? pathname : resolveUserSectionPath\(pathname\)/)
  assert.match(appSource, /if \(isRootLandingPath\) \{[\s\S]*<LandingPage/)
})

test('dashboard route renders inside UserAppShell and bypasses public chrome', () => {
  assert.match(appSource, /if \(resolvedPathname === '\/dashboard'\) \{[\s\S]*return <OperationsDashboard/)
  assert.match(appSource, /if \(useUserShellLayout\) \{[\s\S]*<UserAppShell/)
  assert.match(appSource, /return \([\s\S]*<header className="site-header">[\s\S]*<PublicFooter \/>/)
  assert.match(appSource, /function shouldRenderWithinUserShell\([\s\S]*return isUserShellRoutePath\(resolvedPathname\)/)
})

test('historical read-only users keep Settings inside the workspace shell', () => {
  assert.match(appSource, /canRenderSettingsInReadOnlyWorkspace\(resolvedPathname, subscriptionStateOrStatus\)/)
  assert.match(appSource, /const useAccountShellLayout = [\s\S]*!useUserShellLayout/)
})

test('recoverable payment failures bypass pricing and plan checkout', () => {
  assert.match(appSource, /if \(resolvedPathname === '\/pricing'\) \{\s*if \(requiresBillingRecovery\) \{\s*navigate\('\/billing', \{ replace: true \}\)/)
  assert.match(appSource, /if \(resolvedPathname === '\/checkout'\) \{\s*if \(requiresBillingRecovery\) \{\s*navigate\('\/billing', \{ replace: true \}\)/)
})

test('results root renders empty state safely when data recovery completes with no candidates', () => {
  assert.match(appSource, /if \(isResultsRootPath\(resolvedPathname\)\) \{[\s\S]*route-state--results-empty[\s\S]*RESULTS_EMPTY_STATE_COPY/)
  assert.match(appSource, /candidates:\s*uploadedFiles\?\.candidates \|\| \[\]/)
  assert.match(appSource, /parseMeta:\s*uploadedFiles\?\.parseMeta \|\| null/)
})

test('shared results route keeps shared loading/error/success path without public shell swap', () => {
  assert.match(appSource, /if \(isSharedResultsPath\(resolvedPathname\)\) \{[\s\S]*route-state--shared-error[\s\S]*Shared results unavailable[\s\S]*isSharedLoading=\{sharedResultsLoading\}/)
  assert.match(appSource, /function shouldDisableUserShell\(pathname\) \{[\s\S]*return isSharedResultsPath\(pathname\)/)
})
