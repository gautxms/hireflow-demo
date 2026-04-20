#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const BASELINE_FILE = 'docs/qa/baselines/primitive-visual-regression-baseline.json'
const REQUIRED_COMPONENTS = ['button', 'input', 'card', 'alert', 'table-shell', 'modal-shell', 'badge']
const REQUIRED_STATES = ['default', 'hover', 'focus', 'active', 'disabled']
const REQUIRED_CONTEXTS = ['success', 'warning', 'error', 'info']
const REQUIRED_VIEWPORTS = ['desktop', 'mobile']

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function hasAllValues(actualValues, requiredValues) {
  const actual = new Set(actualValues)
  return requiredValues.every((value) => actual.has(value))
}

const fullPath = path.join(process.cwd(), BASELINE_FILE)
const raw = fs.readFileSync(fullPath, 'utf8')
const baseline = JSON.parse(raw)

assert(typeof baseline.release === 'string' && baseline.release.trim(), 'Baseline release tag is required.')
assert(typeof baseline.reviewedAt === 'string' && baseline.reviewedAt.trim(), 'Baseline reviewedAt date is required.')
assert(typeof baseline.reviewedBy === 'string' && baseline.reviewedBy.trim(), 'Baseline reviewedBy is required.')
assert(baseline.phaseDependency === 'PH8-T2', 'phaseDependency must be PH8-T2.')
assert(Array.isArray(baseline.viewports), 'Baseline viewports array is required.')
assert(Array.isArray(baseline.componentVariants), 'componentVariants array is required.')
assert(Array.isArray(baseline.snapshotMatrix), 'snapshotMatrix array is required.')

const viewportNames = baseline.viewports.map((item) => item?.name)
assert(hasAllValues(viewportNames, REQUIRED_VIEWPORTS), `Missing required viewports: ${REQUIRED_VIEWPORTS.join(', ')}`)

const variantKeys = new Set()
for (const variant of baseline.componentVariants) {
  assert(typeof variant.component === 'string' && variant.component.trim(), 'Each component variant must define component.')
  assert(typeof variant.variant === 'string' && variant.variant.trim(), 'Each component variant must define variant.')
  assert(Array.isArray(variant.states), `states array is required for ${variant.component}/${variant.variant}`)
  assert(Array.isArray(variant.contexts), `contexts array is required for ${variant.component}/${variant.variant}`)
  assert(hasAllValues(variant.states, REQUIRED_STATES), `Missing required states for ${variant.component}/${variant.variant}`)
  assert(hasAllValues(variant.contexts, REQUIRED_CONTEXTS), `Missing required contexts for ${variant.component}/${variant.variant}`)
  variantKeys.add(`${variant.component}:${variant.variant}`)
}

const coveredComponents = new Set(baseline.componentVariants.map((variant) => variant.component))
assert(hasAllValues([...coveredComponents], REQUIRED_COMPONENTS), `Missing required components in componentVariants: ${REQUIRED_COMPONENTS.join(', ')}`)

let previousId = ''
const seenIds = new Set()
const seenSnapshots = new Set()
for (const snapshot of baseline.snapshotMatrix) {
  assert(typeof snapshot.id === 'string' && snapshot.id.trim(), 'Each snapshot entry must include id.')
  assert(typeof snapshot.component === 'string' && snapshot.component.trim(), `Snapshot ${snapshot.id} missing component.`)
  assert(typeof snapshot.variant === 'string' && snapshot.variant.trim(), `Snapshot ${snapshot.id} missing variant.`)
  assert(typeof snapshot.viewport === 'string' && snapshot.viewport.trim(), `Snapshot ${snapshot.id} missing viewport.`)
  assert(snapshot.capture === 'state-strip' || snapshot.capture === 'context-strip', `Snapshot ${snapshot.id} has unsupported capture type.`)
  assert(typeof snapshot.artifact === 'string' && snapshot.artifact.trim(), `Snapshot ${snapshot.id} missing artifact path.`)

  const variantKey = `${snapshot.component}:${snapshot.variant}`
  assert(variantKeys.has(variantKey), `Snapshot ${snapshot.id} references undefined component variant ${variantKey}.`)
  assert(REQUIRED_VIEWPORTS.includes(snapshot.viewport), `Snapshot ${snapshot.id} has unsupported viewport ${snapshot.viewport}.`)

  assert(snapshot.id > previousId, 'snapshotMatrix ids must be strictly sorted for deterministic baselines.')
  previousId = snapshot.id

  assert(!seenIds.has(snapshot.id), `Duplicate snapshot id found: ${snapshot.id}`)
  seenIds.add(snapshot.id)

  const fingerprint = `${variantKey}:${snapshot.viewport}:${snapshot.capture}`
  assert(!seenSnapshots.has(fingerprint), `Duplicate snapshot coverage found for ${fingerprint}.`)
  seenSnapshots.add(fingerprint)
}

for (const variantKey of variantKeys) {
  for (const viewport of REQUIRED_VIEWPORTS) {
    const stateCoverage = `${variantKey}:${viewport}:state-strip`
    const contextCoverage = `${variantKey}:${viewport}:context-strip`
    assert(seenSnapshots.has(stateCoverage), `Missing state-strip snapshot for ${variantKey} (${viewport}).`)
    assert(seenSnapshots.has(contextCoverage), `Missing context-strip snapshot for ${variantKey} (${viewport}).`)
  }
}

assert(typeof baseline.updateProtocol === 'object' && baseline.updateProtocol, 'updateProtocol object is required.')
assert(baseline.updateProtocol.reviewerSignoffRequired === true, 'updateProtocol.reviewerSignoffRequired must be true.')
assert(Array.isArray(baseline.updateProtocol.requiredReviewers) && baseline.updateProtocol.requiredReviewers.length > 0, 'updateProtocol.requiredReviewers must include at least one team.')
assert(Array.isArray(baseline.updateProtocol.baselineUpdateProcess) && baseline.updateProtocol.baselineUpdateProcess.length >= 4, 'updateProtocol.baselineUpdateProcess must include baseline update steps.')

console.log(`✅ Primitive visual baseline is valid: ${baseline.componentVariants.length} variants, ${baseline.snapshotMatrix.length} snapshot entries.`)
