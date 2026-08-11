import pg from 'pg'

const TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114
const UTC_TIMESTAMP_PROBE = '2000-01-01T00:00:00.000Z'

export function parseTimestampWithoutTimeZoneAsUtc(value) {
  if (value === null || value === undefined) return null

  const timestamp = String(value).trim()
  if (!timestamp) return null

  const normalized = timestamp.replace(' ', 'T')
  const explicitUtc = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(normalized)
    ? normalized
    : `${normalized}Z`
  const parsed = new Date(explicitUtc)

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Invalid PostgreSQL timestamp without time zone value')
  }

  return parsed
}

export function installUtcTimestampParser(types = pg.types) {
  types.setTypeParser(TIMESTAMP_WITHOUT_TIME_ZONE_OID, parseTimestampWithoutTimeZoneAsUtc)
}

export function buildUtcPostgresOptions(existingOptions = process.env.PGOPTIONS) {
  const options = String(existingOptions || '').trim()
  return [options, '-c timezone=UTC'].filter(Boolean).join(' ')
}

export async function verifyUtcTimestampContract(db) {
  try {
    const result = await db.query(
      `SELECT current_setting('TimeZone') AS session_timezone,
              '2000-01-01 00:00:00'::timestamp AS timestamp_probe`,
    )
    const row = result.rows?.[0] || {}
    const sessionTimezone = String(row.session_timezone || '').trim()
    const timestampProbe = row.timestamp_probe
    const parserUsesUtc = timestampProbe instanceof Date
      && !Number.isNaN(timestampProbe.getTime())
      && timestampProbe.toISOString() === UTC_TIMESTAMP_PROBE
    const sessionUsesUtc = sessionTimezone.toUpperCase() === 'UTC'
    const errors = []

    if (!sessionUsesUtc) {
      errors.push({
        code: 'PADDLE_DATABASE_TIMEZONE_NOT_UTC',
        message: 'Paddle billing requires PostgreSQL sessions to use UTC.',
      })
    }
    if (!parserUsesUtc) {
      errors.push({
        code: 'PADDLE_TIMESTAMP_PARSER_NOT_UTC',
        message: 'Paddle billing requires timestamp without time zone values to be parsed as UTC.',
      })
    }

    return {
      ready: errors.length === 0,
      sessionTimezone: sessionTimezone || null,
      parserUsesUtc,
      errors,
    }
  } catch {
    return {
      ready: false,
      sessionTimezone: null,
      parserUsesUtc: false,
      errors: [{
        code: 'PADDLE_UTC_TIMESTAMP_CONTRACT_CHECK_FAILED',
        message: 'The Paddle billing UTC timestamp contract could not be verified.',
      }],
    }
  }
}

installUtcTimestampParser()
