import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import process from 'node:process'
import { pool } from '../db/client.js'

process.env.JWT_SECRET = 'test-secret'

const { default: uploadsRouter } = await import('./uploads.js')
const { parseQueue } = await import('../services/jobQueue.js')

after(async () => {
  await parseQueue.close()
  await pool.end()
})

function reservationRow({ id, userId, periodStart, periodEnd }) {
  return {
    id,
    user_id: userId,
    idempotency_key: 'invalid-jd-batch',
    period_start: periodStart,
    period_end: periodEnd,
    requested_units: 1,
    consumed_units: 0,
    released_units: 0,
    status: 'reserved',
    expires_at: new Date(Date.now() + 60_000),
    allocated_reserved_units: 0,
    has_existing_upload: false,
  }
}

test('reserved multipart upload releases its batch before returning an invalid-JD error', async (t) => {
  const previousFlag = process.env.RESUME_QUOTA_RESERVATIONS_ENABLED
  process.env.RESUME_QUOTA_RESERVATIONS_ENABLED = 'true'
  const reservationId = '00000000-0000-4000-8000-000000001201'
  const periodStart = new Date('2026-07-20T08:30:00.000Z')
  const periodEnd = new Date('2026-08-20T08:30:00.000Z')
  const queries = []
  const execute = async (sql, params = []) => {
    const text = String(sql)
    queries.push({ sql: text, params })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
    if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
    if (text.includes('FROM users')) {
      return {
        rows: [{
          id: 7,
          subscription_status: 'active',
          subscription_plan: 'monthly',
          quota_anchor_at: '2026-01-20T08:30:00.000Z',
          cancellation_effective_at: null,
          current_period_end: null,
        }],
      }
    }
    if (text.includes('FROM usage_overrides')) return { rows: [] }
    if (text.includes('FROM usage_log')) return { rows: [{ usage_count: 0 }] }
    if (text.includes('FROM resume_quota_reservations AS reservation')) {
      return { rows: [reservationRow({ id: reservationId, userId: 7, periodStart, periodEnd })] }
    }
    if (text.includes('CREATE TABLE IF NOT EXISTS') || text.includes('ALTER TABLE')) {
      return { rows: [] }
    }
    if (text.includes('FROM job_descriptions')) return { rowCount: 0, rows: [] }
    if (text.includes('FROM resume_quota_reservations') && text.includes('FOR UPDATE')) {
      return { rows: [reservationRow({ id: reservationId, userId: 7, periodStart, periodEnd })] }
    }
    if (text.includes('AS allocated_count')) return { rows: [{ allocated_count: 0 }] }
    if (text.includes('UPDATE resume_quota_reservations')) {
      return {
        rows: [{
          ...reservationRow({ id: reservationId, userId: 7, periodStart, periodEnd }),
          released_units: 1,
          status: 'released',
        }],
      }
    }
    throw new Error(`Unexpected query: ${text}`)
  }
  t.mock.method(pool, 'query', execute)
  t.mock.method(pool, 'connect', async () => ({ query: execute, release() {} }))

  const app = express()
  app.use('/api/uploads', uploadsRouter)
  const server = app.listen(0)
  const form = new FormData()
  form.append('resumes', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'resume.pdf')
  form.append('jobDescriptionId', '00000000-0000-4000-8000-000000001202')
  form.append('quotaReservationId', reservationId)

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt.sign({ userId: 7 }, process.env.JWT_SECRET)}` },
      body: form,
    })
    const payload = await response.json()

    assert.equal(response.status, 404)
    assert.equal(payload.error, 'Job description not found')
    assert.equal(
      queries.some(({ sql }) => sql.includes('UPDATE resume_quota_reservations')),
      true,
    )
    assert.equal(
      queries.some(({ sql }) => sql.includes('INSERT INTO analyses')),
      false,
    )
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    if (previousFlag === undefined) delete process.env.RESUME_QUOTA_RESERVATIONS_ENABLED
    else process.env.RESUME_QUOTA_RESERVATIONS_ENABLED = previousFlag
  }
})
