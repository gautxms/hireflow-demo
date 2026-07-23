import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import {
  allocateResumeQuotaUnit,
  assertResumeQuotaReservationAvailable,
  consumeResumeQuotaAllocation,
  consumeResumeQuotaReservation,
  isResumeQuotaReservationsEnabled,
  releaseResumeQuotaAllocation,
  releaseResumeQuotaAllocationsForAnalysis,
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
  const reservedQuery = calls.find(({ sql }) => sql.includes('AS reserved_count'))
  assert.match(reservedQuery.sql, /active_allocation\.status = 'reserved'/)
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

test('fully allocated reservation remains valid only for an identified session retry', async (t) => {
  const periodStart = new Date('2026-07-01T00:00:00.000Z')
  const periodEnd = new Date('2026-08-01T00:00:00.000Z')
  let reservationQuery = ''
  t.mock.method(pool, 'query', async (sql, params) => {
    reservationQuery = String(sql)
    return {
      rows: [{
        ...reservationRow({
          id: params[0],
          userId: params[1],
          key: 'retry-key',
          requestedUnits: 1,
          periodStart,
          periodEnd,
        }),
        consumed_units: 1,
        status: 'consumed',
        expires_at: new Date(Date.now() - 60_000),
        has_existing_upload: params[4] === 'stable-batch:0',
      }],
    }
  })

  const retry = await assertResumeQuotaReservationAvailable({
    userId: 7,
    reservationId: 'reservation-retry',
    requestedUnits: 1,
    periodStart,
    periodEnd,
    fileIdentity: 'stable-batch:0',
  })
  assert.equal(retry.remainingUnits, 0)
  assert.match(reservationQuery, /reservation\.expires_at > NOW\(\)\s+OR EXISTS/)

  await assert.rejects(
    assertResumeQuotaReservationAvailable({
      userId: 7,
      reservationId: 'reservation-retry',
      requestedUnits: 1,
      periodStart,
      periodEnd,
      fileIdentity: 'different-file',
    }),
    /invalid, expired, or fully allocated/,
  )
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

test('upload allocation claims a reserved unit without recording usage', async (t) => {
  const calls = []
  const stored = reservationRow({
    id: 'reservation-provider-start',
    userId: 10,
    key: 'provider-start',
    requestedUnits: 1,
    periodStart: new Date('2026-07-20T00:00:00.000Z'),
    periodEnd: new Date('2026-08-20T00:00:00.000Z'),
  })
  const allocationRow = {
    id: 'allocation-provider-start',
    reservation_id: stored.id,
    user_id: 10,
    allocation_key: 'upload:upload-provider-start',
    upload_id: 'upload-provider-start',
    status: 'reserved',
  }
  const client = {
    async query(sql) {
      const text = String(sql)
      calls.push(text)
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('FROM resume_quota_allocations') && text.includes('allocation_key')) {
        return { rows: [] }
      }
      if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) {
        return { rows: [stored] }
      }
      if (text.includes('AS allocated_count')) return { rows: [{ allocated_count: 0 }] }
      if (text.includes('INSERT INTO resume_quota_allocations')) return { rows: [allocationRow] }
      if (text.includes('UPDATE upload_chunks')) return { rows: [] }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)

  const result = await allocateResumeQuotaUnit({
    userId: 10,
    reservationId: stored.id,
    allocationKey: allocationRow.allocation_key,
    uploadId: allocationRow.upload_id,
  })

  assert.equal(result.allocation.status, 'reserved')
  assert.equal(calls.some((sql) => sql.includes('INSERT INTO usage_log')), false)
  assert.equal(calls.some((sql) => sql.includes('consumed_units = consumed_units + 1')), false)
})

test('provider-start consumption is idempotent across retries and fallbacks', async (t) => {
  const calls = []
  const reservation = reservationRow({
    id: 'reservation-once',
    userId: 14,
    key: 'consume-once',
    requestedUnits: 1,
    periodStart: new Date('2026-07-20T00:00:00.000Z'),
    periodEnd: new Date('2026-08-20T00:00:00.000Z'),
  })
  const allocation = {
    id: 'allocation-once',
    reservation_id: reservation.id,
    user_id: 14,
    allocation_key: 'upload:once',
    upload_id: 'upload-once',
    status: 'reserved',
  }
  const client = {
    async query(sql) {
      const text = String(sql)
      calls.push(text)
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('FROM resume_quota_allocations') && text.includes('FOR UPDATE')) {
        return { rows: [{ ...allocation }] }
      }
      if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) {
        return { rows: [{ ...reservation }] }
      }
      if (text.includes('INSERT INTO usage_log')) return { rows: [{ id: 'usage-once' }] }
      if (text.includes('UPDATE resume_quota_reservations')) {
        reservation.consumed_units = 1
        reservation.status = 'consumed'
        return { rows: [{ ...reservation }] }
      }
      if (text.includes("UPDATE resume_quota_allocations")) {
        allocation.status = 'consumed'
        allocation.provider = 'anthropic'
        allocation.model = 'claude-test'
        return { rows: [{ ...allocation }] }
      }
      if (text.includes('UPDATE upload_chunks')) return { rows: [] }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)

  const first = await consumeResumeQuotaAllocation({
    userId: 14,
    allocationId: allocation.id,
    provider: 'anthropic',
    model: 'claude-test',
  })
  const retry = await consumeResumeQuotaAllocation({
    userId: 14,
    allocationId: allocation.id,
    provider: 'openai',
    model: 'gpt-test',
  })

  assert.equal(first.alreadyConsumed, false)
  assert.equal(retry.alreadyConsumed, true)
  assert.equal(calls.filter((sql) => sql.includes('INSERT INTO usage_log')).length, 1)
  assert.equal(calls.filter((sql) => sql.includes('consumed_units = consumed_units + 1')).length, 1)
})

test('terminal pre-provider failure releases an allocation without recording usage', async (t) => {
  const calls = []
  const reservation = reservationRow({
    id: 'reservation-release',
    userId: 15,
    key: 'release-before-provider',
    requestedUnits: 1,
    periodStart: new Date('2026-07-20T00:00:00.000Z'),
    periodEnd: new Date('2026-08-20T00:00:00.000Z'),
  })
  const allocation = {
    id: 'allocation-release',
    reservation_id: reservation.id,
    user_id: 15,
    allocation_key: 'upload:release',
    upload_id: 'upload-release',
    status: 'reserved',
  }
  const client = {
    async query(sql) {
      const text = String(sql)
      calls.push(text)
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('FROM resume_quota_allocations') && text.includes('FOR UPDATE')) {
        return { rows: [{ ...allocation }] }
      }
      if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) {
        return { rows: [{ ...reservation }] }
      }
      if (text.includes('UPDATE resume_quota_reservations')) {
        reservation.released_units = 1
        reservation.status = 'released'
        return { rows: [{ ...reservation }] }
      }
      if (text.includes('UPDATE resume_quota_allocations')) {
        allocation.status = 'released'
        allocation.release_reason = 'local_extraction_failed'
        return { rows: [{ ...allocation }] }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)

  const result = await releaseResumeQuotaAllocation({
    userId: 15,
    allocationId: allocation.id,
    reason: 'local_extraction_failed',
  })

  assert.equal(result.released, true)
  assert.equal(result.allocation.status, 'released')
  assert.equal(calls.some((sql) => sql.includes('INSERT INTO usage_log')), false)
})

test('analysis deletion releases every associated pre-provider allocation atomically', async () => {
  const calls = []
  const client = {
    async query(sql, params) {
      const text = String(sql)
      calls.push({ sql: text, params })
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('WITH released AS')) {
        return { rows: [{ unit_count: 2 }, { unit_count: 1 }] }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
  }

  const released = await releaseResumeQuotaAllocationsForAnalysis({
    client,
    userId: 7,
    analysisId: 'analysis-delete',
  })

  assert.equal(released, 3)
  const releaseQuery = calls.find(({ sql }) => sql.includes('WITH released AS'))
  assert.match(releaseQuery.sql, /upload\.analysis_id = \$2/)
  assert.match(releaseQuery.sql, /item\.analysis_id = \$2/)
  assert.match(releaseQuery.sql, /allocation\.status = 'reserved'/)
  assert.match(releaseQuery.sql, /released_units = reservation\.released_units/)
  assert.deepEqual(releaseQuery.params.slice(0, 2), [7, 'analysis-delete'])
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
  const uploadClaim = calls.find(({ sql }) => sql.includes('quota_recorded = true'))
  assert.ok(uploadClaim)
  assert.match(uploadClaim.sql, /quota_reservation_id = \$3/)
  assert.equal(calls.at(-1).sql, 'COMMIT')
})

test('chunk allocation does not double-count a session already claimed by another request', async (t) => {
  const calls = []
  const stored = reservationRow({
    id: 'reservation-duplicate',
    userId: 12,
    key: 'duplicate-session',
    requestedUnits: 2,
    periodStart: new Date('2026-07-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-01T00:00:00.000Z'),
  })
  const client = {
    async query(sql) {
      const text = String(sql)
      calls.push(text)
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) return { rows: [stored] }
      if (text.includes('UPDATE upload_chunks')) return { rows: [] }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)

  const result = await consumeResumeQuotaReservation({
    userId: 12,
    reservationId: 'reservation-duplicate',
    monthStart: new Date('2026-07-01T00:00:00.000Z'),
    uploadId: 'upload-already-claimed',
  })

  assert.equal(result.alreadyRecorded, true)
  assert.equal(calls.some((sql) => sql.includes('INSERT INTO usage_log')), false)
  assert.equal(calls.some((sql) => sql.includes('UPDATE resume_quota_reservations')), false)
  assert.equal(calls.at(-1), 'COMMIT')
})

test('reservation consumption rejects units from a previous quota period', async (t) => {
  const stored = reservationRow({
    id: 'reservation-june',
    userId: 13,
    key: 'june-batch',
    requestedUnits: 1,
    periodStart: new Date('2026-06-01T00:00:00.000Z'),
    periodEnd: new Date('2026-07-01T00:00:00.000Z'),
  })
  const client = {
    async query(sql) {
      const text = String(sql)
      if (['BEGIN', 'ROLLBACK'].includes(text)) return { rows: [] }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) return { rows: [stored] }
      throw new Error(`Unexpected query: ${text}`)
    },
    release() {},
  }
  t.mock.method(pool, 'connect', async () => client)

  await assert.rejects(
    consumeResumeQuotaReservation({
      userId: 13,
      reservationId: 'reservation-june',
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
    }),
    /different quota period/,
  )
})
