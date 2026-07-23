import { pool } from '../db/client.js'

const RESERVATION_TTL_MINUTES = 120
const ADVISORY_LOCK_NAMESPACE = 8002026

function toPositiveInteger(value, fieldName) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`)
  }
  return parsed
}

function toValidDate(value, fieldName) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`)
  }
  return parsed
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 160) {
    throw new Error('quota idempotency key must be between 1 and 160 characters')
  }
  return normalized
}

function normalizeAllocationKey(value) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 200) {
    throw new Error('quota allocation key must be between 1 and 200 characters')
  }
  return normalized
}

function normalizeReservation(row) {
  if (!row) return null
  const requestedUnits = Number(row.requested_units || 0)
  const consumedUnits = Number(row.consumed_units || 0)
  const releasedUnits = Number(row.released_units || 0)
  return {
    id: row.id,
    userId: Number(row.user_id),
    idempotencyKey: row.idempotency_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    requestedUnits,
    consumedUnits,
    releasedUnits,
    remainingUnits: Math.max(requestedUnits - consumedUnits - releasedUnits, 0),
    status: row.status,
    expiresAt: row.expires_at,
  }
}

function normalizeAllocation(row) {
  if (!row) return null
  return {
    id: row.id,
    reservationId: row.reservation_id,
    userId: Number(row.user_id),
    allocationKey: row.allocation_key,
    uploadId: row.upload_id || null,
    resumeId: row.resume_id || null,
    parseJobId: row.parse_job_id || null,
    status: row.status,
    provider: row.provider || null,
    model: row.model || null,
    consumedAt: row.consumed_at || null,
    releasedAt: row.released_at || null,
    releaseReason: row.release_reason || null,
  }
}

export class ResumeQuotaExceededError extends Error {
  constructor({ limit, used, reserved, requested }) {
    super('Resume analysis quota exceeded')
    this.name = 'ResumeQuotaExceededError'
    this.code = 'RESUME_QUOTA_EXCEEDED'
    this.details = {
      limit,
      used,
      reserved,
      requested,
      remaining: Math.max(limit - used - reserved, 0),
    }
  }
}

export function isResumeQuotaReservationsEnabled(env = process.env) {
  return String(env.RESUME_QUOTA_RESERVATIONS_ENABLED || 'false').trim().toLowerCase() === 'true'
}

async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function lockUserQuota(client, userId) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, $2)',
    [ADVISORY_LOCK_NAMESPACE, Number(userId)],
  )
}

export async function reserveResumeQuotaUnits({
  userId,
  periodStart,
  periodEnd,
  uploadLimit,
  requestedUnits,
  idempotencyKey,
  shouldResetUsage = false,
}) {
  const normalizedUserId = toPositiveInteger(userId, 'userId')
  const normalizedLimit = toPositiveInteger(uploadLimit, 'uploadLimit')
  const normalizedRequestedUnits = toPositiveInteger(requestedUnits, 'requestedUnits')
  const normalizedPeriodStart = toValidDate(periodStart, 'periodStart')
  const normalizedPeriodEnd = toValidDate(periodEnd, 'periodEnd')
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey)

  return withTransaction(async (client) => {
    await lockUserQuota(client, normalizedUserId)

    const existingResult = await client.query(
      `SELECT *
       FROM resume_quota_reservations
       WHERE user_id = $1 AND idempotency_key = $2
       LIMIT 1
       FOR UPDATE`,
      [normalizedUserId, normalizedKey],
    )
    const existing = normalizeReservation(existingResult.rows[0])
    if (existing) {
      const sameRequest = existing.requestedUnits === normalizedRequestedUnits
        && new Date(existing.periodStart).getTime() === normalizedPeriodStart.getTime()
        && new Date(existing.periodEnd).getTime() === normalizedPeriodEnd.getTime()
      if (!sameRequest) {
        throw new Error('quota idempotency key was already used for a different request')
      }
      return { reservation: existing, duplicate: true }
    }

    const usageResult = shouldResetUsage
      ? { rows: [{ usage_count: 0 }] }
      : await client.query(
        `SELECT COUNT(*)::INT AS usage_count
         FROM usage_log
         WHERE user_id = $1
           AND (
             (quota_allocation_id IS NOT NULL AND month_start = $2::date)
             OR (
               quota_allocation_id IS NULL
               AND created_at >= $2
               AND created_at < $3
             )
           )`,
        [normalizedUserId, normalizedPeriodStart, normalizedPeriodEnd],
      )
    const reservedResult = await client.query(
      `SELECT COALESCE(SUM(
         CASE
           WHEN reservation.expires_at > NOW()
             THEN reservation.requested_units
                  - reservation.consumed_units
                  - reservation.released_units
           ELSE (
             SELECT COUNT(*)::INT
             FROM resume_quota_allocations AS allocation
             WHERE allocation.reservation_id = reservation.id
               AND allocation.status = 'reserved'
           )
         END
       ), 0)::INT AS reserved_count
       FROM resume_quota_reservations AS reservation
       WHERE reservation.user_id = $1
         AND reservation.period_start = $2
         AND reservation.period_end = $3
         AND reservation.status = 'reserved'
         AND (
           reservation.expires_at > NOW()
           OR EXISTS (
             SELECT 1
             FROM resume_quota_allocations AS active_allocation
             WHERE active_allocation.reservation_id = reservation.id
               AND active_allocation.status = 'reserved'
           )
         )`,
      [normalizedUserId, normalizedPeriodStart, normalizedPeriodEnd],
    )

    const used = Number(usageResult.rows[0]?.usage_count || 0)
    const reserved = Number(reservedResult.rows[0]?.reserved_count || 0)
    if (used + reserved + normalizedRequestedUnits > normalizedLimit) {
      throw new ResumeQuotaExceededError({
        limit: normalizedLimit,
        used,
        reserved,
        requested: normalizedRequestedUnits,
      })
    }

    const insertResult = await client.query(
      `INSERT INTO resume_quota_reservations
        (user_id, idempotency_key, period_start, period_end, requested_units, expires_at)
       VALUES
        ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 minute'))
       RETURNING *`,
      [
        normalizedUserId,
        normalizedKey,
        normalizedPeriodStart,
        normalizedPeriodEnd,
        normalizedRequestedUnits,
        RESERVATION_TTL_MINUTES,
      ],
    )

    return {
      reservation: normalizeReservation(insertResult.rows[0]),
      duplicate: false,
      used,
      reserved,
    }
  })
}

export async function assertResumeQuotaReservationAvailable({
  userId,
  reservationId,
  requestedUnits = 1,
  periodStart,
  periodEnd,
  fileIdentity = null,
}) {
  const normalizedUnits = toPositiveInteger(requestedUnits, 'requestedUnits')
  const result = await pool.query(
    `SELECT reservation.*,
            (
              SELECT COUNT(*)::INT
              FROM resume_quota_allocations
              WHERE reservation_id = reservation.id
                AND status = 'reserved'
            ) AS allocated_reserved_units,
            EXISTS (
              SELECT 1
              FROM upload_chunks
              WHERE user_id = $2
                AND quota_reservation_id = $1
                AND file_identity = NULLIF($5, '')
                AND status = 'uploading'
                AND expires_at > NOW()
            ) AS has_existing_upload
     FROM resume_quota_reservations AS reservation
     WHERE reservation.id = $1
       AND reservation.user_id = $2
       AND reservation.period_start = $3
       AND reservation.period_end = $4
       AND reservation.status IN ('reserved', 'consumed')
       AND (
         reservation.expires_at > NOW()
         OR EXISTS (
           SELECT 1
           FROM upload_chunks AS active_upload
           WHERE active_upload.user_id = $2
             AND active_upload.quota_reservation_id = $1
             AND active_upload.file_identity = NULLIF($5, '')
             AND active_upload.status = 'uploading'
             AND active_upload.expires_at > NOW()
         )
       )
     LIMIT 1`,
    [reservationId, userId, periodStart, periodEnd, String(fileIdentity || '').trim()],
  )
  const row = result.rows[0]
  const reservation = normalizeReservation(row)
  const isExistingUploadRetry = row?.has_existing_upload === true
  const allocatedReservedUnits = Number(row?.allocated_reserved_units || 0)
  const availableUnits = Math.max(
    Number(reservation?.remainingUnits || 0) - allocatedReservedUnits,
    0,
  )
  if (!reservation || (availableUnits < normalizedUnits && !isExistingUploadRetry)) {
    throw new Error('Resume quota reservation is invalid, expired, or fully allocated')
  }
  return { ...reservation, availableUnits }
}

export async function allocateResumeQuotaUnit({
  userId,
  reservationId,
  allocationKey,
  uploadId = null,
  resumeId = null,
  parseJobId = null,
}) {
  const normalizedUserId = toPositiveInteger(userId, 'userId')
  const normalizedKey = normalizeAllocationKey(allocationKey)

  return withTransaction(async (client) => {
    await lockUserQuota(client, normalizedUserId)

    const existingResult = await client.query(
      `SELECT *
       FROM resume_quota_allocations
       WHERE user_id = $1
         AND allocation_key = $2
       LIMIT 1
       FOR UPDATE`,
      [normalizedUserId, normalizedKey],
    )
    const existing = normalizeAllocation(existingResult.rows[0])
    if (existing) {
      if (existing.reservationId !== reservationId) {
        throw new Error('quota allocation key was already used for a different reservation')
      }
      return { allocation: existing, duplicate: true }
    }

    const reservationResult = await client.query(
      `SELECT *
       FROM resume_quota_reservations
       WHERE id = $1
         AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [reservationId, normalizedUserId],
    )
    const reservation = normalizeReservation(reservationResult.rows[0])
    if (
      !reservation
      || reservation.status !== 'reserved'
      || new Date(reservation.expiresAt).getTime() <= Date.now()
    ) {
      throw new Error('Resume quota reservation is invalid or expired')
    }

    const allocatedResult = await client.query(
      `SELECT COUNT(*)::INT AS allocated_count
       FROM resume_quota_allocations
       WHERE reservation_id = $1
         AND status = 'reserved'`,
      [reservationId],
    )
    const allocated = Number(allocatedResult.rows[0]?.allocated_count || 0)
    if (reservation.remainingUnits - allocated < 1) {
      throw new Error('Resume quota reservation does not have an unallocated unit')
    }

    const insertResult = await client.query(
      `INSERT INTO resume_quota_allocations
        (reservation_id, user_id, allocation_key, upload_id, resume_id, parse_job_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        reservationId,
        normalizedUserId,
        normalizedKey,
        uploadId || null,
        resumeId || null,
        parseJobId ? String(parseJobId) : null,
      ],
    )
    const allocation = normalizeAllocation(insertResult.rows[0])

    if (uploadId) {
      await client.query(
        `UPDATE upload_chunks
         SET quota_reservation_id = $3,
             quota_allocation_id = $4,
             quota_recorded = false,
             updated_at = NOW()
         WHERE upload_id = $1
           AND user_id = $2`,
        [uploadId, normalizedUserId, reservationId, allocation.id],
      )
    }
    if (parseJobId) {
      await client.query(
        `UPDATE parse_jobs
         SET quota_allocation_id = $2,
             updated_at = NOW()
         WHERE job_id = $1
           AND user_id = $3`,
        [String(parseJobId), allocation.id, normalizedUserId],
      )
    }

    return { allocation, reservation, duplicate: false }
  })
}

export async function consumeResumeQuotaAllocation({
  userId,
  allocationId,
  ipAddress = 'unknown',
  provider = null,
  model = null,
}) {
  const normalizedUserId = toPositiveInteger(userId, 'userId')

  return withTransaction(async (client) => {
    await lockUserQuota(client, normalizedUserId)
    const allocationResult = await client.query(
      `SELECT *
       FROM resume_quota_allocations
       WHERE id = $1
         AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [allocationId, normalizedUserId],
    )
    const allocation = normalizeAllocation(allocationResult.rows[0])
    if (!allocation) {
      throw new Error('Resume quota allocation was not found')
    }
    if (allocation.status === 'consumed') {
      return { allocation, alreadyConsumed: true }
    }
    if (allocation.status !== 'reserved') {
      throw new Error('Resume quota allocation was already released')
    }

    const reservationResult = await client.query(
      `SELECT *
       FROM resume_quota_reservations
       WHERE id = $1
         AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [allocation.reservationId, normalizedUserId],
    )
    const reservation = normalizeReservation(reservationResult.rows[0])
    if (!reservation || reservation.remainingUnits < 1) {
      throw new Error('Resume quota reservation cannot be consumed')
    }

    const usageResult = await client.query(
      `INSERT INTO usage_log
        (user_id, ip_address, month_start, quota_allocation_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (quota_allocation_id) WHERE quota_allocation_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [normalizedUserId, ipAddress, reservation.periodStart, allocation.id],
    )
    if (!usageResult.rows[0]) {
      throw new Error('Resume quota usage was already recorded without allocation settlement')
    }

    const reservationUpdate = await client.query(
      `UPDATE resume_quota_reservations
       SET consumed_units = consumed_units + 1,
           status = CASE
             WHEN consumed_units + released_units + 1 = requested_units THEN 'consumed'
             ELSE 'reserved'
           END,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [allocation.reservationId, normalizedUserId],
    )
    const allocationUpdate = await client.query(
      `UPDATE resume_quota_allocations
       SET status = 'consumed',
           provider = NULLIF($3, ''),
           model = NULLIF($4, ''),
           consumed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [
        allocation.id,
        normalizedUserId,
        String(provider || '').trim(),
        String(model || '').trim(),
      ],
    )
    if (allocation.uploadId) {
      await client.query(
        `UPDATE upload_chunks
         SET quota_recorded = true,
             updated_at = NOW()
         WHERE upload_id = $1
           AND user_id = $2`,
        [allocation.uploadId, normalizedUserId],
      )
    }

    return {
      allocation: normalizeAllocation(allocationUpdate.rows[0]),
      reservation: normalizeReservation(reservationUpdate.rows[0]),
      alreadyConsumed: false,
    }
  })
}

export async function releaseResumeQuotaAllocation({
  userId,
  allocationId,
  reason = 'pre_provider_failure',
}) {
  const normalizedUserId = toPositiveInteger(userId, 'userId')

  return withTransaction(async (client) => {
    await lockUserQuota(client, normalizedUserId)
    const allocationResult = await client.query(
      `SELECT *
       FROM resume_quota_allocations
       WHERE id = $1
         AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [allocationId, normalizedUserId],
    )
    const allocation = normalizeAllocation(allocationResult.rows[0])
    if (!allocation || allocation.status !== 'reserved') {
      return { allocation, released: false }
    }

    const reservationResult = await client.query(
      `SELECT *
       FROM resume_quota_reservations
       WHERE id = $1
         AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [allocation.reservationId, normalizedUserId],
    )
    const reservation = normalizeReservation(reservationResult.rows[0])
    if (!reservation) {
      throw new Error('Resume quota reservation was not found')
    }

    const reservationUpdate = await client.query(
      `UPDATE resume_quota_reservations
       SET released_units = released_units + 1,
           status = CASE
             WHEN consumed_units + released_units + 1 = requested_units
               THEN CASE WHEN consumed_units > 0 THEN 'consumed' ELSE 'released' END
             ELSE 'reserved'
           END,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [allocation.reservationId, normalizedUserId],
    )
    const allocationUpdate = await client.query(
      `UPDATE resume_quota_allocations
       SET status = 'released',
           released_at = NOW(),
           release_reason = $3,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [allocation.id, normalizedUserId, String(reason || 'pre_provider_failure').slice(0, 160)],
    )

    return {
      allocation: normalizeAllocation(allocationUpdate.rows[0]),
      reservation: normalizeReservation(reservationUpdate.rows[0]),
      released: true,
    }
  })
}

export async function releaseResumeQuotaAllocationsForAnalysis({
  client,
  userId,
  analysisId,
  reason = 'analysis_deleted_before_provider',
}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('transaction client is required')
  }
  const normalizedUserId = toPositiveInteger(userId, 'userId')
  const normalizedAnalysisId = String(analysisId || '').trim()
  if (!normalizedAnalysisId) {
    throw new Error('analysisId is required')
  }

  await lockUserQuota(client, normalizedUserId)
  const result = await client.query(
    `WITH released AS (
       UPDATE resume_quota_allocations AS allocation
       SET status = 'released',
           released_at = NOW(),
           release_reason = $3,
           updated_at = NOW()
       WHERE allocation.user_id = $1
         AND allocation.status = 'reserved'
         AND (
           EXISTS (
             SELECT 1
             FROM upload_chunks AS upload
             WHERE upload.quota_allocation_id = allocation.id
               AND upload.analysis_id = $2
           )
           OR EXISTS (
             SELECT 1
             FROM analysis_items AS item
             WHERE item.analysis_id = $2
               AND (
                 item.parse_job_id = allocation.parse_job_id
                 OR item.resume_id = allocation.resume_id
               )
           )
         )
       RETURNING allocation.reservation_id
     ),
     release_counts AS (
       SELECT reservation_id, COUNT(*)::INT AS unit_count
       FROM released
       GROUP BY reservation_id
     )
     UPDATE resume_quota_reservations AS reservation
     SET released_units = reservation.released_units + release_counts.unit_count,
         status = CASE
           WHEN reservation.consumed_units
                + reservation.released_units
                + release_counts.unit_count = reservation.requested_units
             THEN CASE WHEN reservation.consumed_units > 0 THEN 'consumed' ELSE 'released' END
           ELSE 'reserved'
         END,
         updated_at = NOW()
     FROM release_counts
     WHERE reservation.id = release_counts.reservation_id
       AND reservation.user_id = $1
     RETURNING release_counts.unit_count`,
    [
      normalizedUserId,
      normalizedAnalysisId,
      String(reason || 'analysis_deleted_before_provider').slice(0, 160),
    ],
  )

  return result.rows.reduce((total, row) => total + Number(row.unit_count || 0), 0)
}

export async function consumeResumeQuotaReservation({
  userId,
  reservationId,
  units = 1,
  ipAddress = 'unknown',
  monthStart,
  uploadId = null,
}) {
  const normalizedUnits = toPositiveInteger(units, 'units')
  const normalizedMonthStart = toValidDate(monthStart, 'monthStart')

  return withTransaction(async (client) => {
    await lockUserQuota(client, userId)
    const result = await client.query(
      `SELECT *
       FROM resume_quota_reservations
       WHERE id = $1 AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [reservationId, userId],
    )
    const reservation = normalizeReservation(result.rows[0])
    if (!reservation || reservation.status !== 'reserved' || new Date(reservation.expiresAt).getTime() <= Date.now()) {
      throw new Error('Resume quota reservation is invalid or expired')
    }
    if (reservation.remainingUnits < normalizedUnits) {
      throw new Error('Resume quota reservation does not have enough remaining units')
    }
    if (new Date(reservation.periodStart).getTime() !== normalizedMonthStart.getTime()) {
      throw new Error('Resume quota reservation belongs to a different quota period')
    }

    if (uploadId) {
      const uploadUpdate = await client.query(
        `UPDATE upload_chunks
         SET quota_recorded = true,
             quota_reservation_id = $3,
             updated_at = NOW()
         WHERE upload_id = $1
           AND user_id = $2
           AND quota_recorded = false
         RETURNING upload_id`,
        [uploadId, userId, reservationId],
      )
      if (!uploadUpdate.rows[0]) {
        return { ...reservation, alreadyRecorded: true }
      }
    }
    await client.query(
      `INSERT INTO usage_log (user_id, ip_address, month_start)
       SELECT $1, $2, $3
       FROM generate_series(1, $4)`,
      [userId, ipAddress, normalizedMonthStart, normalizedUnits],
    )
    const updateResult = await client.query(
      `UPDATE resume_quota_reservations
       SET consumed_units = consumed_units + $3,
           status = CASE
             WHEN consumed_units + released_units + $3 = requested_units THEN 'consumed'
             ELSE 'reserved'
           END,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [reservationId, userId, normalizedUnits],
    )
    return normalizeReservation(updateResult.rows[0])
  })
}

export async function releaseResumeQuotaReservation({ userId, reservationId, units = 1 }) {
  const normalizedUnits = toPositiveInteger(units, 'units')

  return withTransaction(async (client) => {
    await lockUserQuota(client, userId)
    const result = await client.query(
      `SELECT *
       FROM resume_quota_reservations
       WHERE id = $1 AND user_id = $2
       LIMIT 1
       FOR UPDATE`,
      [reservationId, userId],
    )
    const reservation = normalizeReservation(result.rows[0])
    if (!reservation || reservation.status !== 'reserved') {
      return reservation
    }

    const allocatedResult = await client.query(
      `SELECT COUNT(*)::INT AS allocated_count
       FROM resume_quota_allocations
       WHERE reservation_id = $1
         AND status = 'reserved'`,
      [reservationId],
    )
    const allocatedUnits = Number(allocatedResult.rows[0]?.allocated_count || 0)
    const unallocatedUnits = Math.max(reservation.remainingUnits - allocatedUnits, 0)
    const releasedUnits = Math.min(normalizedUnits, unallocatedUnits)
    if (releasedUnits === 0) return reservation

    const updateResult = await client.query(
      `UPDATE resume_quota_reservations
       SET released_units = released_units + $3,
           status = CASE
             WHEN consumed_units + released_units + $3 = requested_units
               THEN CASE WHEN consumed_units > 0 THEN 'consumed' ELSE 'released' END
             ELSE 'reserved'
           END,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [reservationId, userId, releasedUnits],
    )
    return normalizeReservation(updateResult.rows[0])
  })
}
