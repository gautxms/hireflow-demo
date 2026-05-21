#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const BASELINE_FILE = 'docs/qa/baselines/dashboard-visual-baseline.json'
const REQUIRED_VIEWPORTS = [
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
]
const REQUIRED_ROUTE = '/dashboard'

const REQUIRED_SCENES = ['sidebar-active', 'filters-actions', 'charts-analyses', 'charts-average-score']

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
  assert(Array.isArray(routeSnapshot.covers), `Snapshot covers array missing for ${viewport.name}`)
  for (const scene of REQUIRED_SCENES) {
    assert(routeSnapshot.covers.includes(scene), `Snapshot ${viewport.name} missing required scene: ${scene}`)
  }
}

console.log(`✅ Dashboard visual baseline includes ${REQUIRED_VIEWPORTS.length} required viewports.`)
