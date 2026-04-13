import crypto from 'crypto'
import { pool } from '../db/client.js'
import { sendDemoRequestEmail } from './emailService.js'

const SUPPORTED_TRANSACTIONAL_TYPES = new Set(['demo.request.submitted', 'demo.request.received'])

function normalizeIdempotencyKey(inputKey, fallbackSeed) {
  const raw = String(inputKey || '').trim()
  if (raw) {
    return raw.slice(0, 128)
  }
  return `auto:${crypto.createHash('sha256').update(String(fallbackSeed || '')).digest('hex')}`
}

export async function ensureNotificationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notification_type TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
      error_message TEXT,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_created
      ON notification_deliveries (user_id, created_at DESC);
  `)
}

export async function createTransactionalNotification({
  userId = null,
  type,
  recipientEmail,
  payload = {},
  idempotencyKey,
}) {
  if (!SUPPORTED_TRANSACTIONAL_TYPES.has(type)) {
    throw new Error('Unsupported notification type')
  }

  const normalizedEmail = String(recipientEmail || '').trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('A valid recipient email is required')
  }

  const effectiveIdempotencyKey = normalizeIdempotencyKey(
    idempotencyKey,
    `${type}|${normalizedEmail}|${JSON.stringify(payload)}`,
  )

  const existingResult = await pool.query(
    `SELECT id, status, idempotency_key, created_at
     FROM notification_deliveries
     WHERE idempotency_key = $1
     LIMIT 1`,
    [effectiveIdempotencyKey],
  )

  if (existingResult.rowCount > 0) {
    return {
      duplicate: true,
      idempotencyKey: effectiveIdempotencyKey,
      delivery: existingResult.rows[0],
    }
  }

  let status = 'sent'
  let errorMessage = null

  try {
    if (type === 'demo.request.submitted' || type === 'demo.request.received') {
      const sent = await sendDemoRequestEmail({
        requesterName: payload.requesterName || 'there',
        requesterEmail: normalizedEmail,
        company: payload.company || 'Unknown company',
        phone: payload.phone || '',
        message: payload.message || 'Thanks for your demo request.',
        to: normalizedEmail,
      })

      if (!sent) {
        status = 'failed'
        errorMessage = 'Email transport is unavailable'
      }
    }
  } catch (error) {
    status = 'failed'
    errorMessage = error?.message || 'Failed to send notification email'
  }

  const insertResult = await pool.query(
    `INSERT INTO notification_deliveries (
       user_id,
       notification_type,
       recipient_email,
       idempotency_key,
       status,
       error_message,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, user_id, notification_type, recipient_email, idempotency_key, status, error_message, metadata, created_at`,
    [
      userId,
      type,
      normalizedEmail,
      effectiveIdempotencyKey,
      status,
      errorMessage,
      JSON.stringify(payload || {}),
    ],
  )

  return {
    duplicate: false,
    idempotencyKey: effectiveIdempotencyKey,
    delivery: insertResult.rows[0],
  }
}

export async function listUserNotifications({ userId, page = 1, pageSize = 20 }) {
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1)
  const safePageSize = Math.max(1, Math.min(100, Number.parseInt(String(pageSize), 10) || 20))
  const offset = (safePage - 1) * safePageSize

  const result = await pool.query(
    `WITH scoped AS (
      SELECT id, notification_type, recipient_email, status, error_message, metadata, created_at,
             COUNT(*) OVER () AS total_count
      FROM notification_deliveries
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    )
    SELECT * FROM scoped`,
    [userId, safePageSize, offset],
  )

  const total = result.rows[0] ? Number(result.rows[0].total_count) : 0
  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    pages: Math.ceil(total / safePageSize) || 1,
    items: result.rows,
  }
}
