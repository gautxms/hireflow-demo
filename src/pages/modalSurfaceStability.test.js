import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const variablesCss = readFileSync(new URL('../styles/variables.css', import.meta.url), 'utf8')
const primitivesCss = readFileSync(new URL('../styles/ui-primitives.css', import.meta.url), 'utf8')
const analysesCss = readFileSync(new URL('../styles/analyses.css', import.meta.url), 'utf8')
const jobCss = readFileSync(new URL('../styles/job-description.css', import.meta.url), 'utf8')
const analysesSource = readFileSync(new URL('./AnalysesPage.jsx', import.meta.url), 'utf8')
const jobModalSource = readFileSync(new URL('../components/jobs/JobModal.jsx', import.meta.url), 'utf8')

function extractRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] || ''
}

test('shared modal panel has an explicit opaque design-token surface and isolated translucent backdrop', () => {
  assert.match(variablesCss, /--hf-surface-raised:\s*var\(--hf-bg-secondary\);/)
  assert.match(variablesCss, /--color-surface-raised:\s*var\(--hf-surface-raised\);/)

  const cardRule = extractRule(primitivesCss, '.ui-card')
  const dialogRule = extractRule(primitivesCss, '.ui-modal__dialog')
  const modalRule = extractRule(primitivesCss, '.ui-modal')

  assert.match(cardRule, /background:\s*var\(--color-surface-raised,\s*var\(--hf-surface,\s*var\(--color-bg-secondary\)\)\);/)
  assert.match(dialogRule, /background:\s*var\(--color-surface-raised,\s*var\(--hf-surface,\s*var\(--color-bg-secondary\)\)\);/)
  assert.match(modalRule, /background:\s*var\(--hf-bg-overlay-80,\s*rgba\(0, 0, 0, 0\.76\)\);/)
  assert.doesNotMatch(cardRule + dialogRule, /opacity\s*:/)
  assert.doesNotMatch(cardRule + dialogRule, /backdrop-filter|filter\s*:/)
})

test('create analysis and job modals use shared modal primitives with route-specific opaque panels', () => {
  assert.match(analysesSource, /className="ui-modal analyses-create-modal"/)
  assert.match(analysesSource, /className="ui-card ui-card--card-spacing ui-modal__dialog analyses-create-modal__dialog"/)
  assert.match(jobModalSource, /className="ui-modal job-modal"/)
  assert.match(jobModalSource, /className="ui-card ui-card--card-spacing ui-modal__dialog job-modal__dialog"/)

  assert.match(analysesCss, /\.analyses-modal__actions\s*\{[\s\S]*background:\s*var\(--color-surface-raised\);[\s\S]*\}/)
  assert.match(jobCss, /\.job-modal__dialog\s*\{[\s\S]*background:\s*var\(--color-surface-raised\);[\s\S]*\}/)
  assert.match(jobCss, /\.job-modal__header\s*\{[\s\S]*background:\s*var\(--color-surface-raised\);[\s\S]*\}/)
  assert.match(jobCss, /\.job-form__footer\s*\{[\s\S]*background:\s*var\(--color-surface-raised\);[\s\S]*\}/)
})
