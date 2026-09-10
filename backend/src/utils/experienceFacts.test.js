import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildExperienceFacts,
  normalizeStructuredExperienceEntries,
} from './experienceFacts.js'

const REFERENCE_DATE = '2026-09-10T00:00:00.000Z'

test('normalizes bounded structured experience entries without retaining arbitrary fields', () => {
  const entries = normalizeStructuredExperienceEntries([{
    role: 'Account Executive',
    organization: 'Example Co',
    startDate: '2024-01',
    endDate: '2025-07',
    highlights: ['Owned quota', 'Closed enterprise opportunities'],
    injected: 'must not be retained',
  }])

  assert.deepEqual(entries, [{
    title: 'Account Executive',
    company: 'Example Co',
    start_date: '2024-01',
    end_date: '2025-07',
    duration: null,
    description: 'Owned quota; Closed enterprise opportunities',
  }])
  assert.equal('injected' in entries[0], false)
})

test('computes decimal experience from structured month dates without changing source data', () => {
  const source = [{ title: 'Account Executive', startDate: '2024-01', endDate: '2025-07' }]
  const snapshot = structuredClone(source)
  const facts = buildExperienceFacts(source, { referenceDate: REFERENCE_DATE })

  assert.deepEqual(source, snapshot)
  assert.equal(facts.status, 'computed')
  assert.equal(facts.total_months, 18)
  assert.equal(facts.total_years, 1.5)
  assert.equal(facts.confidence, 'high')
  assert.equal(facts.source, 'structured_dates')
  assert.equal(facts.reference_date, '2026-09-10')
})

test('uses one fixed reference month for current roles', () => {
  const facts = buildExperienceFacts([
    { title: 'Current role', startDate: '2025-03', endDate: 'Present' },
  ], { referenceDate: REFERENCE_DATE })

  assert.equal(facts.total_months, 18)
  assert.equal(facts.entry_facts[0].end_date, '2026-09')
  assert.equal(facts.entry_facts[0].is_current, true)
})

test('merges overlapping employment intervals instead of double-counting them', () => {
  const facts = buildExperienceFacts([
    { title: 'Role A', startDate: '2020-01', endDate: '2022-01' },
    { title: 'Role B', startDate: '2021-01', endDate: '2023-01' },
  ], { referenceDate: REFERENCE_DATE })

  assert.equal(facts.total_months, 36)
  assert.equal(facts.overlap_months_removed, 12)
})

test('falls back to a parseable duration range and lowers confidence for year-only dates', () => {
  const facts = buildExperienceFacts([
    { title: 'Role A', duration: '2020-2024' },
  ], { referenceDate: REFERENCE_DATE })

  assert.equal(facts.total_months, 48)
  assert.equal(facts.source, 'duration_range')
  assert.equal(facts.confidence, 'medium')
  assert.equal(facts.entry_facts[0].precision, 'year')
})

test('reports partial and unavailable timelines conservatively', () => {
  const partial = buildExperienceFacts([
    { title: 'Role A', startDate: '2020-01', endDate: '2022-01' },
    { title: 'Role B', duration: 'dates unavailable' },
  ], { referenceDate: REFERENCE_DATE })
  const unavailable = buildExperienceFacts(['display-only experience'], { referenceDate: REFERENCE_DATE })

  assert.equal(partial.total_months, 24)
  assert.equal(partial.confidence, 'low')
  assert.equal(partial.unparsed_entry_count, 1)
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.total_months, null)
  assert.equal(unavailable.entry_count, 0)
})

test('rejects reversed ranges and represents same-month roles as zero complete months', () => {
  const facts = buildExperienceFacts([
    { title: 'Reversed', startDate: '2024-06', endDate: '2024-01' },
    { title: 'Zero length', startDate: '2024-01', endDate: '2024-01' },
  ], { referenceDate: REFERENCE_DATE })

  assert.equal(facts.status, 'computed')
  assert.equal(facts.total_months, 0)
  assert.equal(facts.parsed_entry_count, 1)
  assert.equal(facts.unparsed_entry_count, 1)
})

test('caps future end dates at the reference month and lowers confidence', () => {
  const facts = buildExperienceFacts([
    { title: 'Current role with future model date', startDate: '2026-01', endDate: '2027-01' },
  ], { referenceDate: REFERENCE_DATE })

  assert.equal(facts.total_months, 8)
  assert.equal(facts.confidence, 'medium')
  assert.equal(facts.entry_facts[0].end_date, '2026-09')
  assert.deepEqual(facts.entry_facts[0].date_anomalies, ['end_after_reference_date_capped'])
})
