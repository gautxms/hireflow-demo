#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const BASELINE_FILE = 'docs/qa/baselines/landing-above-fold-visual-baseline.json'
const REQUIRED_VIEWPORTS = ['1366x768', '1920x1080']
const REQUIRED_AUTH_STATES = ['authenticated', 'unauthenticated']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const fullPath = path.join(process.cwd(), BASELINE_FILE)
const baseline = JSON.parse(fs.readFileSync(fullPath, 'utf8'))

assert(typeof baseline.release === 'string' && baseline.release.trim(), 'release is required')
assert(typeof baseline.reviewedAt === 'string' && baseline.reviewedAt.trim(), 'reviewedAt is required')
assert(typeof baseline.reviewedBy === 'string' && baseline.reviewedBy.trim(), 'reviewedBy is required')
assert(Array.isArray(baseline.snapshotMatrix), 'snapshotMatrix array is required')
assert(Array.isArray(baseline.uiRegressionChecks), 'uiRegressionChecks array is required')

for (const viewport of REQUIRED_VIEWPORTS) {
  for (const authState of REQUIRED_AUTH_STATES) {
    const snapshot = baseline.snapshotMatrix.find((item) => item?.viewport === viewport && item?.authState === authState)
    assert(snapshot, `Missing snapshot for ${viewport} (${authState})`)
    assert(typeof snapshot.artifact === 'string' && snapshot.artifact.trim(), `Missing artifact for ${viewport} (${authState})`)

    const check = baseline.uiRegressionChecks.find((item) => item?.viewport === viewport && item?.authState === authState)
    assert(check, `Missing uiRegressionCheck for ${viewport} (${authState})`)
    assert(Array.isArray(check.assertions) && check.assertions.length >= 3, `uiRegressionCheck assertions are required for ${viewport} (${authState})`)
  }
}

console.log(`✅ Landing visual baseline looks complete: ${baseline.snapshotMatrix.length} snapshots, ${baseline.uiRegressionChecks.length} checks.`)
