import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { FAILURE_CATEGORIES, PARSE_OUTCOMES, normalizeFailureCategory, normalizeParseOutcome } from '../contracts/parseResultEnums.js'

test('parseOutcome canonical enum rejects non-canonical values', () => {
  assert.equal(normalizeParseOutcome('success', 'failed'), 'success')
  assert.equal(normalizeParseOutcome('partial', 'failed'), 'partial')
  assert.equal(normalizeParseOutcome('failed', 'success'), 'failed')
  assert.equal(normalizeParseOutcome('complete', 'failed'), 'failed')
})

test('failureCategory must be canonical or explicitly mapped to unknown', () => {
  assert.equal(normalizeFailureCategory('encrypted_or_password_protected_pdf', { fallback: 'unknown' }), 'encrypted_or_password_protected_pdf')
  assert.equal(normalizeFailureCategory('legacy_unmapped_reason', { fallback: 'unknown' }), 'unknown')
  assert.equal(normalizeFailureCategory(null, { fallback: 'unknown' }), null)
})

test('docs enum examples match canonical emitted API enums', () => {
  const doc = fs.readFileSync(new URL('../../../docs/api/analysis-response.md', import.meta.url), 'utf8')
  const parseOutcomeMatch = doc.match(/Enum:\s*`([^`]+)`/)
  assert.ok(parseOutcomeMatch)
  const docOutcomes = parseOutcomeMatch[1].split('|').map((v) => v.trim())
  assert.deepEqual(docOutcomes, PARSE_OUTCOMES)

  const failureSection = doc.split('### `failureCategory`')[1].split('Exact meanings:')[0]
  const docFailure = [...failureSection.matchAll(/- `([^`]+)`/g)].map((m) => m[1])
  assert.deepEqual(docFailure, FAILURE_CATEGORIES)
})
