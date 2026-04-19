#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()

function read(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ADMIN_UI_ENDPOINT_SMOKE_CHECKS = [
  { path: '/auth/admin/login', method: 'POST', body: { email: 'smoke@example.com', password: 'invalid' }, area: 'login' },
  { path: '/auth/admin/2fa/setup', method: 'POST', body: { token: 'invalid-token' }, area: '2fa setup' },
  { path: '/auth/admin/2fa/verify', method: 'POST', body: { token: 'invalid-token', code: '000000' }, area: '2fa verify' },
  { path: '/admin/sessions', method: 'GET', area: 'session timer', requiresAdminAuth: true },
  { path: '/admin/sessions/refresh', method: 'POST', area: 'session refresh', requiresAdminAuth: true },
  { path: '/auth/admin/logout', method: 'POST', area: 'logout', requiresAdminAuth: true },
  { path: '/admin/users?limit=1&page=1', method: 'GET', area: 'users tab', requiresAdminAuth: true },
  { path: '/admin/subscriptions?limit=1&page=1', method: 'GET', area: 'billing tab - subscriptions', requiresAdminAuth: true },
  { path: '/admin/payments?limit=1&page=1', method: 'GET', area: 'billing tab - payments', requiresAdminAuth: true },
  { path: '/admin/uploads?limit=1&page=1', method: 'GET', area: 'uploads tab', requiresAdminAuth: true },
  { path: '/admin/uploads/export?page=1&pageSize=1', method: 'GET', area: 'uploads csv export', requiresAdminAuth: true },
  { path: '/admin/analytics?startDate=2026-01-01&endDate=2026-01-30', method: 'GET', area: 'analytics tab', requiresAdminAuth: true },
  { path: '/admin/analytics/metrics?startDate=2026-01-01&endDate=2026-01-30', method: 'GET', area: 'analytics metrics', requiresAdminAuth: true },
  { path: '/admin/logs?limit=1&page=1', method: 'GET', area: 'logs tab', requiresAdminAuth: true },
  { path: '/admin/health', method: 'GET', area: 'health tab', requiresAdminAuth: true },
  { path: '/admin/actions?limit=1', method: 'GET', area: 'security tab audit events', requiresAdminAuth: true },
]

async function run() {
  const appSource = read('src/App.jsx')
  const navigationSource = read('src/admin/config/adminNavigation.js')
  const authSource = read('src/admin/hooks/useAdminAuth.js')
  const shellSource = read('src/admin/components/AdminShell.jsx')
  const analyticsSource = read('src/admin/pages/AdminAnalyticsPage.jsx')
  const uploadsSource = read('src/admin/pages/AdminUploadsPage.jsx')
  const uploadsHookSource = read('src/admin/hooks/useAdminUploads.js')
  const loginPageSource = read('src/admin/pages/AdminLoginPage.jsx')

  const navHrefs = [...navigationSource.matchAll(/href:\s*'([^']+)'/g)].map((match) => match[1])
  assert(navHrefs.length > 0, 'No admin navigation routes were found in adminNavigation.js')

  for (const href of navHrefs) {
    const routeRegex = new RegExp(`pathname\\s*===\\s*'${regexEscape(href)}'`)
    assert(routeRegex.test(appSource), `Missing route branch for ${href} in src/App.jsx (route 404 regression risk).`)
  }

  assert(/pathname\s*===\s*'\/admin'\s*\|\|\s*pathname\s*===\s*'\/admin\/overview'/.test(appSource), 'Missing canonical /admin or /admin/overview alias route.')
  assert(/pathname\.startsWith\('\/admin\/users\/'\)/.test(appSource), 'Missing /admin/users/:id detail route guard.')
  assert(/pathname\.startsWith\('\/admin\/uploads\/'\)/.test(appSource), 'Missing /admin/uploads/:id detail route guard.')

  assert(/mobileNavOpen\s*\?/.test(shellSource), 'AdminShell mobile drawer must be conditionally rendered to prevent persistent overlays.')
  assert(/admin-shell-v2__mobile-backdrop/.test(shellSource), 'AdminShell is missing mobile backdrop control for overlay dismissal.')
  assert(/setMobileNavOpen\(false\)/.test(shellSource), 'AdminShell missing explicit overlay close action.')

  for (const endpoint of ['/auth/admin/login', '/admin/sessions/refresh', '/auth/admin/logout']) {
    assert(authSource.includes(endpoint), `Missing auth flow endpoint call for ${endpoint}.`)
  }
  assert(/acceptedEula/.test(authSource), 'EULA gating state is missing in useAdminAuth.')
  assert(/needsTwoFactor/.test(authSource), '2FA gating state is missing in useAdminAuth.')
  assert(/sessionSecondsLeft/.test(authSource), 'Session timer state is missing in useAdminAuth.')
  assert(/localStorage\.removeItem\(ADMIN_SESSION_STORAGE_KEY\)/.test(authSource), 'Admin session clear is missing from useAdminAuth (auth regression risk).')
    assert(loginPageSource.includes('Session timer:') && loginPageSource.includes('{formattedTimer}'), 'Admin login page is missing the visible session timer.')
  assert(/onClick=\{\(\) => logout\(\)\}/.test(loginPageSource), 'Admin login page is missing the explicit logout control.')

  assert(/const kpis = analytics\?\.kpis \|\| \{\}/.test(analyticsSource), 'Analytics KPIs are not normalized with a fallback object (partial data can crash widgets).')
  assert(/const tokenUsageSummary = analytics\?\.tokenUsageSummary \|\| \{\}/.test(analyticsSource), 'Token usage summary is not normalized with a fallback object in analytics page.')

  assert(/tokenUsage\?\.totalTokens/.test(uploadsSource), 'Uploads token usage metrics are not null-safe in admin uploads page.')
  assert(/csvExportUrl=\{exportCsvUrl\}/.test(uploadsSource), 'Uploads export wiring missing from table component.')
  assert(/exportCsvUrl:\s*`\$\{API_BASE\}\/admin\/uploads\/export\?\$\{queryString\}`/.test(uploadsHookSource), 'Uploads CSV export endpoint missing in useAdminUploads.')

  const baseUrl = process.env.ADMIN_SMOKE_BASE_URL
  if (baseUrl) {
    const normalizedBaseUrl = baseUrl.endsWith('/api') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/api`
    const adminSmokeToken = process.env.ADMIN_SMOKE_ADMIN_TOKEN

    const authProtectedChecks = ADMIN_UI_ENDPOINT_SMOKE_CHECKS.filter((check) => check.requiresAdminAuth)
    if (authProtectedChecks.length > 0) {
      assert(
        Boolean(adminSmokeToken),
        'Live API checks require ADMIN_SMOKE_ADMIN_TOKEN so admin routes fail on missing endpoints instead of passing with 401/403.',
      )
    }

    for (const check of ADMIN_UI_ENDPOINT_SMOKE_CHECKS) {
      const url = new URL(check.path, normalizedBaseUrl).toString()
      const headers = {}
      if (check.body) {
        headers['Content-Type'] = 'application/json'
      }
      if (check.requiresAdminAuth) {
        headers.Authorization = `Bearer ${adminSmokeToken}`
      }

      const response = await fetch(url, {
        method: check.method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: check.body ? JSON.stringify(check.body) : undefined,
      })

      assert(response.status !== 404, `${check.method} ${check.path} (${check.area}) returned 404 (route blocker regression).`)
      if (check.requiresAdminAuth) {
        assert(
          response.status !== 401 && response.status !== 403,
          `${check.method} ${check.path} (${check.area}) returned ${response.status}; verify ADMIN_SMOKE_ADMIN_TOKEN is valid for admin route coverage checks.`,
        )
      }
    }

    console.log(`✅ Live API smoke checks passed against ${normalizedBaseUrl} (${ADMIN_UI_ENDPOINT_SMOKE_CHECKS.length} routes).`)
  } else {
    console.log('ℹ️ Skipping live API checks (set ADMIN_SMOKE_BASE_URL + ADMIN_SMOKE_ADMIN_TOKEN to enable).')
  }

  console.log(`✅ Admin smoke checks passed for ${navHrefs.length} admin navigation routes.`)
}

run().catch((error) => {
  console.error('❌ Admin smoke checks failed.')
  console.error(error.message)
  process.exit(1)
})
