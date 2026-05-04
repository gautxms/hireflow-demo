#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const BASELINE_FILE = 'docs/qa/baselines/dashboard-visual-baseline.json'
const REQUIRED_VIEWPORTS = [
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
]
const REQUIRED_ROUTE = '/dashboard'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const fullPath = path.join(process.cwd(), BASELINE_FILE)
const baseline = JSON.parse(fs.readFileSync(fullPath, 'utf8'))

assert(Array.isArray(baseline.viewports), 'viewports array is required')
assert(Array.isArray(baseline.snapshotMatrix), 'snapshotMatrix array is required')

for (const viewport of REQUIRED_VIEWPORTS) {
  const found = baseline.viewports.find((item) => item?.name === viewport.name)
  assert(found, `Missing viewport ${viewport.name}`)
  assert(found.width === viewport.width && found.height === viewport.height, `Viewport ${viewport.name} dimensions must be ${viewport.width}x${viewport.height}`)
}

for (const viewport of REQUIRED_VIEWPORTS) {
  const routeSnapshot = baseline.snapshotMatrix.find((item) => item?.path === REQUIRED_ROUTE && item?.viewport === viewport.name)
  assert(routeSnapshot, `Missing ${REQUIRED_ROUTE} snapshot for ${viewport.name}`)
  assert(typeof routeSnapshot.image === 'string' && routeSnapshot.image.trim(), `Snapshot image reference missing for ${viewport.name}`)
}

console.log(`✅ Dashboard visual baseline includes ${REQUIRED_VIEWPORTS.length} required viewports.`)
