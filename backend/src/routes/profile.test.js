import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRate, resolveDashboardDateRange } from './profile.js'

test('resolveDashboardDateRange defaults to last 30 days', () => {
  const now = new Date('2026-04-26T12:00:00.000Z')
  const result = resolveDashboardDateRange({}, now)

  assert.equal(result.startDate.toISOString().slice(0, 10), '2026-03-28')
  assert.equal(result.endDate.toISOString().slice(0, 10), '2026-04-26')
  assert.equal(result.effectiveRangeDays, 30)
})

test('resolveDashboardDateRange rejects ranges above max', () => {
  assert.throws(
    () => resolveDashboardDateRange({ startDate: '2025-01-01', endDate: '2026-04-26' }),
    /Date range cannot exceed 180 days/,
  )
})

test('formatRate returns 0 for zero or null denominators', () => {
  assert.equal(formatRate(10, 0), 0)
  assert.equal(formatRate(10, null), 0)
  assert.equal(formatRate(10, undefined), 0)
})

test('formatRate returns 0 for null numerators and caps rates at 100%', () => {
  assert.equal(formatRate(null, 5), 0)
  assert.equal(formatRate(undefined, 5), 0)
  assert.equal(formatRate(7, 5), 100)
})
