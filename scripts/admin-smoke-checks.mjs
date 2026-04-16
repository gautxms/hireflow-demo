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

async function run() {
  const appSource = read('src/App.jsx')
  const navigationSource = read('src/admin/config/adminNavigation.js')
  const authSource = read('src/admin/hooks/useAdminAuth.js')
  const shellSource = read('src/admin/components/AdminShell.jsx')
  const analyticsSource = read('src/admin/pages/AdminAnalyticsPage.jsx')
  const uploadsSource = read('src/admin/pages/AdminUploadsPage.jsx')
  const uploadsHookSource = read('src/admin/hooks/useAdminUploads.js')

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
  assert(/localStorage\.removeItem\(ADMIN_SESSION_STORAGE_KEY\)/.test(authSource), 'Admin session clear is missing from useAdminAuth (auth regression risk).')

  assert(/const kpis = analytics\?\.kpis \|\| \{\}/.test(analyticsSource), 'Analytics KPIs are not normalized with a fallback object (partial data can crash widgets).')
  assert(/const tokenUsageSummary = analytics\?\.tokenUsageSummary \|\| \{\}/.test(analyticsSource), 'Token usage summary is not normalized with a fallback object in analytics page.')

  assert(/tokenUsage\?\.totalTokens/.test(uploadsSource), 'Uploads token usage metrics are not null-safe in admin uploads page.')
  assert(/csvExportUrl=\{exportCsvUrl\}/.test(uploadsSource), 'Uploads export wiring missing from table component.')
  assert(/exportCsvUrl:\s*`\$\{API_BASE\}\/admin\/uploads\/export\?\$\{queryString\}`/.test(uploadsHookSource), 'Uploads CSV export endpoint missing in useAdminUploads.')

  const baseUrl = process.env.ADMIN_SMOKE_BASE_URL
  if (baseUrl) {
    const endpointChecks = [
      { path: '/auth/admin/login', method: 'POST', body: { email: 'smoke@example.com', password: 'invalid' } },
      { path: '/auth/admin/logout', method: 'POST' },
      { path: '/admin/sessions/refresh', method: 'POST' },
      { path: '/admin/uploads/export?page=1&pageSize=1', method: 'GET' },
      { path: '/admin/analytics/export?range=30d', method: 'GET' },
    ]

    for (const check of endpointChecks) {
      const url = new URL(check.path, baseUrl).toString()
      const response = await fetch(url, {
        method: check.method,
        headers: check.body ? { 'Content-Type': 'application/json' } : undefined,
        body: check.body ? JSON.stringify(check.body) : undefined,
      })
      assert(response.status !== 404, `${check.method} ${check.path} returned 404 (route blocker regression).`)
    }

    console.log(`✅ Live API smoke checks passed against ${baseUrl}`)
  } else {
    console.log('ℹ️ Skipping live API checks (set ADMIN_SMOKE_BASE_URL to enable).')
  }

  console.log(`✅ Admin smoke checks passed for ${navHrefs.length} admin navigation routes.`)
}

run().catch((error) => {
  console.error('❌ Admin smoke checks failed.')
  console.error(error.message)
  process.exit(1)
})
