#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const BASELINE_FILE = 'docs/qa/baselines/admin-visual-baseline.json'
const REQUIRED_VIEWPORTS = ['desktop', 'mobile']
const REQUIRED_ROUTES = [
  '/admin/login',
  '/admin/overview',
  '/admin/users',
  '/admin/billing',
  '/admin/uploads',
  '/admin/analytics',
  '/admin/logs',
  '/admin/health',
  '/admin/security',
]
const REQUIRED_UI_REGRESSION_CHECKS = [
  { path: '/admin/analytics', viewport: 'desktop', state: 'default' },
  { path: '/admin/analytics', viewport: 'mobile', state: 'drawer-closed' },
  { path: '/admin/analytics', viewport: 'mobile', state: 'drawer-open' },
]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const fullPath = path.join(process.cwd(), BASELINE_FILE)
const raw = fs.readFileSync(fullPath, 'utf8')
const baseline = JSON.parse(raw)

assert(typeof baseline.release === 'string' && baseline.release.trim(), 'Baseline release tag is required.')
assert(typeof baseline.reviewedAt === 'string' && baseline.reviewedAt.trim(), 'Baseline reviewedAt date is required.')
assert(typeof baseline.reviewedBy === 'string' && baseline.reviewedBy.trim(), 'Baseline reviewedBy is required.')
assert(Array.isArray(baseline.viewports), 'Baseline viewports array is required.')
assert(Array.isArray(baseline.snapshotMatrix), 'Baseline snapshotMatrix array is required.')
assert(Array.isArray(baseline.uiRegressionChecks), 'Baseline uiRegressionChecks array is required.')

const viewportNames = new Set(baseline.viewports.map((item) => item?.name))
for (const viewport of REQUIRED_VIEWPORTS) {
  assert(viewportNames.has(viewport), `Missing required viewport baseline: ${viewport}`)
}

const routeSet = new Set(baseline.snapshotMatrix.map((item) => item?.path))
for (const route of REQUIRED_ROUTES) {
  assert(routeSet.has(route), `Missing required snapshot route: ${route}`)
}

for (const check of REQUIRED_UI_REGRESSION_CHECKS) {
  const checkEntry = baseline.uiRegressionChecks.find(
    (item) => item?.path === check.path && item?.viewport === check.viewport && item?.state === check.state,
  )
  assert(checkEntry, `Missing required uiRegressionCheck for ${check.path} (${check.viewport}, ${check.state}).`)
  assert(Array.isArray(checkEntry.assertions) && checkEntry.assertions.length > 0, `uiRegressionCheck assertions are required for ${check.path} (${check.viewport}, ${check.state}).`)
}

assert(typeof baseline.screenshotEvidence === 'object' && baseline.screenshotEvidence, 'Baseline screenshotEvidence metadata is required.')
assert(baseline.screenshotEvidence.beforeAfterRequired === true, 'beforeAfterRequired must be true in screenshotEvidence.')
assert(Array.isArray(baseline.screenshotEvidence.requiredViewports), 'screenshotEvidence.requiredViewports must be an array.')
for (const viewport of REQUIRED_VIEWPORTS) {
  assert(baseline.screenshotEvidence.requiredViewports.includes(viewport), `screenshotEvidence.requiredViewports missing: ${viewport}`)
}
assert(Array.isArray(baseline.screenshotEvidence.baselineUpdateProcess) && baseline.screenshotEvidence.baselineUpdateProcess.length >= 3, 'screenshotEvidence.baselineUpdateProcess must include baseline update steps.')

console.log(`✅ Admin visual baseline looks complete: ${baseline.snapshotMatrix.length} snapshots, ${baseline.viewports.length} viewports.`)
