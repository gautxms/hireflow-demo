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
           AND month_start = $2::date`,
        [normalizedUserId, normalizedPeriodStart],
      )
    const reservedResult = await client.query(
      `SELECT COALESCE(SUM(requested_units - consumed_units - released_units), 0)::INT AS reserved_count
       FROM resume_quota_reservations
       WHERE user_id = $1
         AND period_start = $2
         AND period_end = $3
         AND status = 'reserved'
         AND expires_at > NOW()`,
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
       AND reservation.expires_at > NOW()
     LIMIT 1`,
    [reservationId, userId, periodStart, periodEnd, String(fileIdentity || '').trim()],
  )
  const row = result.rows[0]
  const reservation = normalizeReservation(row)
  const isExistingUploadRetry = row?.has_existing_upload === true
  if (!reservation || (reservation.remainingUnits < normalizedUnits && !isExistingUploadRetry)) {
    throw new Error('Resume quota reservation is invalid, expired, or fully allocated')
  }
  return reservation
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
             quota_reservation_id = COALESCE(quota_reservation_id, $3),
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

    const releasedUnits = Math.min(normalizedUnits, reservation.remainingUnits)
    if (releasedUnits === 0) return reservation

    const updateResult = await client.query(
      `UPDATE resume_quota_reservations
       SET released_units = released_units + $3,
           status = CASE
             WHEN consumed_units + released_units + $3 = requested_units THEN 'released'
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
