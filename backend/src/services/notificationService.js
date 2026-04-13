import crypto from 'crypto'
import { pool } from '../db/client.js'
import {
  sendDemoRequestConfirmationEmail,
  sendDemoRequestEmail,
} from './emailService.js'

const SUPPORTED_TRANSACTIONAL_TYPES = new Set(['demo.request.submitted', 'demo.request.received'])

function normalizeIdempotencyKey(inputKey, fallbackSeed) {
  const raw = String(inputKey || '').trim()
  if (raw) {
    return raw.slice(0, 128)
  }
  return `auto:${crypto.createHash('sha256').update(String(fallbackSeed || '')).digest('hex')}`
}

async function fetchExistingDelivery(idempotencyKey) {
  const existingResult = await pool.query(
    `SELECT id, user_id, notification_type, recipient_email, idempotency_key, status, error_message, metadata, created_at
     FROM notification_deliveries
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey],
  )

  return existingResult.rows[0] || null
}

async function reserveDelivery({ userId, type, recipientEmail, idempotencyKey, payload }) {
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
     VALUES ($1, $2, $3, $4, 'failed', 'pending', $5::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, user_id, notification_type, recipient_email, idempotency_key, status, error_message, metadata, created_at`,
    [
      userId,
      type,
      recipientEmail,
      idempotencyKey,
      JSON.stringify(payload || {}),
    ],
  )

  return insertResult.rows[0] || null
}

async function finalizeDelivery({ id, status, errorMessage = null }) {
  const result = await pool.query(
    `UPDATE notification_deliveries
     SET status = $2,
         error_message = $3
     WHERE id = $1
     RETURNING id, user_id, notification_type, recipient_email, idempotency_key, status, error_message, metadata, created_at`,
    [id, status, errorMessage],
  )

  return result.rows[0]
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

  const reserved = await reserveDelivery({
    userId,
    type,
    recipientEmail: normalizedEmail,
    idempotencyKey: effectiveIdempotencyKey,
    payload,
  })

  if (!reserved) {
    const existing = await fetchExistingDelivery(effectiveIdempotencyKey)
    return {
      duplicate: true,
      idempotencyKey: effectiveIdempotencyKey,
      delivery: existing,
    }
  }

  let status = 'sent'
  let errorMessage = null

  try {
    if (type === 'demo.request.received') {
      const sent = await sendDemoRequestEmail({
        requesterName: payload.requesterName || 'there',
        requesterEmail: payload.requesterEmail || normalizedEmail,
        company: payload.company || 'Unknown company',
        phone: payload.phone || '',
        message: payload.message || 'New demo request.',
        to: normalizedEmail,
      })

      if (!sent) {
        status = 'failed'
        errorMessage = 'Email transport is unavailable'
      }
    }

    if (type === 'demo.request.submitted') {
      const sent = await sendDemoRequestConfirmationEmail({
        to: normalizedEmail,
        requesterName: payload.requesterName || 'there',
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

  const delivery = await finalizeDelivery({
    id: reserved.id,
    status,
    errorMessage,
  })

  return {
    duplicate: false,
    idempotencyKey: effectiveIdempotencyKey,
    delivery,
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
