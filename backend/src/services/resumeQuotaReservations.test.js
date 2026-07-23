import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import {
  consumeResumeQuotaReservation,
  isResumeQuotaReservationsEnabled,
  reserveResumeQuotaUnits,
  ResumeQuotaExceededError,
} from './resumeQuotaReservations.js'

function reservationRow({ id, userId, key, requestedUnits, periodStart, periodEnd }) {
  return {
    id,
    user_id: userId,
    idempotency_key: key,
    period_start: periodStart,
    period_end: periodEnd,
    requested_units: requestedUnits,
    consumed_units: 0,
    released_units: 0,
    status: 'reserved',
    expires_at: new Date(Date.now() + 60_000),
  }
}

function mockReservationDatabase(t, { used = 0 } = {}) {
  const reservations = []
  const calls = []
  let nextId = 1
  const client = {
    async query(sql, params = []) {
      const text = String(sql)
      calls.push({ sql: text, params })
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('WHERE user_id = $1 AND idempotency_key = $2')) {
        return { rows: reservations.filter((row) => row.user_id === params[0] && row.idempotency_key === params[1]) }
      }
      if (text.includes('FROM usage_log')) return { rows: [{ usage_count: used }] }
      if (text.includes('AS reserved_count')) {
        const reservedCount = reservations
          .filter((row) => row.user_id === params[0] && row.status === 'reserved')
          .reduce((sum, row) => sum + row.requested_units - row.consumed_units - row.released_units, 0)
        return { rows: [{ reserved_count: reservedCount }] }
      }
      if (text.includes('INSERT INTO resume_quota_reservations')) {
        const row = reservationRow({
          id: `reservation-${nextId++}`,
          userId: params[0],
          key: params[1],
          periodStart: params[2],
          periodEnd: params[3],
          requestedUnits: params[4],
        })
        reservations.push(row)
        return { rows: [row] }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)
  return { calls, reservations }
}

test('reservation rollout remains disabled unless explicitly enabled', () => {
  assert.equal(isResumeQuotaReservationsEnabled({}), false)
  assert.equal(isResumeQuotaReservationsEnabled({ RESUME_QUOTA_RESERVATIONS_ENABLED: 'true' }), true)
  assert.equal(isResumeQuotaReservationsEnabled({ RESUME_QUOTA_RESERVATIONS_ENABLED: 'false' }), false)
})

test('atomic reservation permits the 800th unit and blocks a concurrent 801st unit', async (t) => {
  const { calls, reservations } = mockReservationDatabase(t, { used: 799 })
  const common = {
    userId: 42,
    periodStart: new Date('2026-07-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-01T00:00:00.000Z'),
    uploadLimit: 800,
    requestedUnits: 1,
  }

  const first = await reserveResumeQuotaUnits({ ...common, idempotencyKey: 'batch-one' })
  assert.equal(first.reservation.remainingUnits, 1)
  assert.equal(reservations.length, 1)

  await assert.rejects(
    reserveResumeQuotaUnits({ ...common, idempotencyKey: 'batch-two' }),
    (error) => {
      assert.ok(error instanceof ResumeQuotaExceededError)
      assert.deepEqual(error.details, {
        limit: 800,
        used: 799,
        reserved: 1,
        requested: 1,
        remaining: 0,
      })
      return true
    },
  )

  assert.equal(reservations.length, 1)
  assert.equal(calls.filter(({ sql }) => sql.includes('pg_advisory_xact_lock')).length, 2)
  assert.equal(calls.some(({ sql }) => sql === 'ROLLBACK'), true)
})

test('replaying a batch idempotency key returns the original reservation', async (t) => {
  const { reservations } = mockReservationDatabase(t, { used: 100 })
  const request = {
    userId: 7,
    periodStart: new Date('2026-07-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-01T00:00:00.000Z'),
    uploadLimit: 800,
    requestedUnits: 10,
    idempotencyKey: 'same-batch',
  }

  const first = await reserveResumeQuotaUnits(request)
  const replay = await reserveResumeQuotaUnits(request)

  assert.equal(replay.duplicate, true)
  assert.equal(replay.reservation.id, first.reservation.id)
  assert.equal(reservations.length, 1)
})

test('a 795 plus 10 batch is rejected as one request', async (t) => {
  mockReservationDatabase(t, { used: 795 })

  await assert.rejects(
    reserveResumeQuotaUnits({
      userId: 9,
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      uploadLimit: 800,
      requestedUnits: 10,
      idempotencyKey: 'ten-file-batch',
    }),
    ResumeQuotaExceededError,
  )
})

test('chunk allocation records usage, session state, and reservation consumption in one transaction', async (t) => {
  const calls = []
  const stored = reservationRow({
    id: 'reservation-atomic',
    userId: 11,
    key: 'atomic-session',
    requestedUnits: 1,
    periodStart: new Date('2026-07-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-01T00:00:00.000Z'),
  })
  const client = {
    async query(sql, params = []) {
      const text = String(sql)
      calls.push({ sql: text, params })
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) {
        return { rows: [stored] }
      }
      if (text.includes('INSERT INTO usage_log')) return { rows: [] }
      if (text.includes('UPDATE upload_chunks')) return { rows: [{ upload_id: 'upload-atomic' }] }
      if (text.includes('UPDATE resume_quota_reservations')) {
        return {
          rows: [{
            ...stored,
            consumed_units: 1,
            status: 'consumed',
          }],
        }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)

  const result = await consumeResumeQuotaReservation({
    userId: 11,
    reservationId: 'reservation-atomic',
    units: 1,
    monthStart: new Date('2026-07-01T00:00:00.000Z'),
    ipAddress: '127.0.0.1',
    uploadId: 'upload-atomic',
  })

  assert.equal(result.status, 'consumed')
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO usage_log')), true)
  assert.equal(calls.some(({ sql }) => sql.includes('quota_recorded = true')), true)
  assert.equal(calls.at(-1).sql, 'COMMIT')
})
