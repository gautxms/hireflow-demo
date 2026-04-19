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

const viewportNames = new Set(baseline.viewports.map((item) => item?.name))
for (const viewport of REQUIRED_VIEWPORTS) {
  assert(viewportNames.has(viewport), `Missing required viewport baseline: ${viewport}`)
}

const routeSet = new Set(baseline.snapshotMatrix.map((item) => item?.path))
for (const route of REQUIRED_ROUTES) {
  assert(routeSet.has(route), `Missing required snapshot route: ${route}`)
}

console.log(`✅ Admin visual baseline looks complete: ${baseline.snapshotMatrix.length} snapshots, ${baseline.viewports.length} viewports.`)
