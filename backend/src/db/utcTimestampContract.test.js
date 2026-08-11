import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {
  buildUtcPostgresOptions,
  installUtcDateSerialization,
  parseTimestampWithoutTimeZoneAsUtc,
} from './utcTimestampContract.js'

test('timestamp without time zone parser treats database wall-clock values as UTC', () => {
  assert.equal(
    parseTimestampWithoutTimeZoneAsUtc('2026-01-31 23:30:00').toISOString(),
    '2026-01-31T23:30:00.000Z',
  )
  assert.equal(
    parseTimestampWithoutTimeZoneAsUtc('2026-01-31T23:30:00.123').toISOString(),
    '2026-01-31T23:30:00.123Z',
  )
  assert.throws(
    () => parseTimestampWithoutTimeZoneAsUtc('not-a-timestamp'),
    /Invalid PostgreSQL timestamp without time zone value/,
  )
})

test('PostgreSQL connection options preserve existing settings and force UTC last', () => {
  assert.equal(buildUtcPostgresOptions(), '-c timezone=UTC')
  assert.equal(
    buildUtcPostgresOptions('-c statement_timeout=5000'),
    '-c statement_timeout=5000 -c timezone=UTC',
  )
})

test('JavaScript Date parameters are configured for UTC serialization', () => {
  const defaults = { parseInputDatesAsUTC: false }
  installUtcDateSerialization(defaults)
  assert.equal(defaults.parseInputDatesAsUTC, true)
  assert.equal(pg.defaults.parseInputDatesAsUTC, true)
})
