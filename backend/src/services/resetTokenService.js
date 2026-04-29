import crypto from 'crypto'
import { pool } from '../db/client.js'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000
const RESET_RATE_LIMIT_MAX = 3

const resetAttemptsByEmail = new Map()

export function normalizeEmail(email) {
  if (typeof email !== 'string') {
    return ''
  }

  return email.trim().toLowerCase()
}

function pruneAttempts(attempts, now = Date.now()) {
  const oneHourAgo = now - RESET_TOKEN_TTL_MS
  return attempts.filter((timestamp) => timestamp > oneHourAgo)
}

export function getResetRateLimitState(email, now = Date.now()) {
  const attempts = pruneAttempts(resetAttemptsByEmail.get(email) || [], now)
  resetAttemptsByEmail.set(email, attempts)

  if (attempts.length < RESET_RATE_LIMIT_MAX) {
    return { blocked: false, retryAfterSeconds: 0 }
  }

  const retryAfterMs = attempts[0] + RESET_TOKEN_TTL_MS - now

  return {
    blocked: retryAfterMs > 0,
    retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 0),
  }
}

export function recordResetAttempt(email, now = Date.now()) {
  const attempts = pruneAttempts(resetAttemptsByEmail.get(email) || [], now)
  resetAttemptsByEmail.set(email, [...attempts, now])
}

export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex')
}

export async function createPasswordResetToken(userId, token) {
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, token, expiresAt],
  )

  return expiresAt
}

export async function getValidResetTokenRecord(token) {
  const result = await pool.query(
    `SELECT prt.id,
            prt.user_id,
            prt.token,
            prt.expires_at,
            prt.used,
            u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token = $1
       AND prt.used = false
       AND prt.expires_at > NOW()
     LIMIT 1`,
    [token],
  )

  return result.rows[0] || null
}

export async function markTokenUsedAndResetPassword({ tokenId, userId, passwordHash }) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2`,
      [passwordHash, userId],
    )

    await client.query(
      `UPDATE password_reset_tokens
       SET used = true,
           used_at = NOW()
       WHERE id = $1`,
      [tokenId],
    )

    await client.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1
         AND used = false
         AND expires_at > NOW()`,
      [userId],
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
