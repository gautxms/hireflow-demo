import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

import { pool } from '../db/client.js'
import { up as addResumeQuotaAnchor } from '../db/migrations/045-add-resume-quota-anchor.js'
import { up as addResumeQuotaReservations } from '../db/migrations/046-add-resume-quota-reservations.js'
import { up as addResumeQuotaAllocations } from '../db/migrations/047-add-resume-quota-allocations.js'
import { verifyResumeQuotaReservationSchema } from '../db/schemaPrerequisites.js'
import {
  reserveResumeQuotaUnits,
  ResumeQuotaExceededError,
} from './resumeQuotaReservations.js'

const databaseUrl = process.env.RESUME_QUOTA_POSTGRES_TEST_DATABASE_URL
const { Pool } = pg

async function resetSchema(db) {
  await db.query(`
    DROP TABLE IF EXISTS
      resume_quota_allocations,
      resume_quota_reservations,
      usage_log,
      upload_chunks,
      parse_jobs,
      resumes,
      users
    CASCADE
  `)
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await db.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      subscription_status TEXT NOT NULL DEFAULT 'active',
      current_period_end TIMESTAMP
    )
  `)
  await db.query(`
    CREATE TABLE resumes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  await db.query(`
    CREATE TABLE upload_chunks (
      upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
      parse_job_id TEXT,
      status TEXT NOT NULL DEFAULT 'uploading',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
    )
  `)
  await db.query(`
    CREATE TABLE parse_jobs (
      job_id TEXT PRIMARY KEY,
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE TABLE usage_log (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      month_start DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

async function migrateQuotaSchema(db) {
  await addResumeQuotaAnchor(db)
  await addResumeQuotaReservations(db)
  await addResumeQuotaAllocations(db)
}

async function seedUserAndUsage(db, used, periodStart) {
  const user = (await db.query(
    `INSERT INTO users (subscription_status, current_period_end)
     VALUES ('active', $1)
     RETURNING id`,
    [periodStart],
  )).rows[0]
  if (used > 0) {
    await db.query(
      `INSERT INTO usage_log (user_id, ip_address, month_start, created_at)
       SELECT $1, 'quota-postgres-test', $2::date, $2::timestamp + INTERVAL '1 hour'
       FROM generate_series(1, $3)`,
      [user.id, periodStart, used],
    )
  }
  return user.id
}

function quotaPeriod() {
  const periodStart = new Date()
  periodStart.setUTCDate(1)
  periodStart.setUTCHours(0, 0, 0, 0)
  const periodEnd = new Date(Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth() + 1,
    1,
  ))
  return { periodStart, periodEnd }
}

test('PostgreSQL resume quota reservations enforce the 800-unit boundary atomically', {
  skip: !databaseUrl,
}, async (t) => {
  const db = new Pool({ connectionString: databaseUrl, max: 20 })
  t.after(async () => {
    await resetSchema(db)
    await db.end()
    await pool.end()
  })

  await t.test('migrations 045-047 create every required quota column and index', async () => {
    await resetSchema(db)
    const missing = await verifyResumeQuotaReservationSchema(db)
    assert.equal(missing.ok, false)

    await migrateQuotaSchema(db)
    const migrated = await verifyResumeQuotaReservationSchema(db)
    assert.equal(migrated.ok, true, JSON.stringify(migrated))
    assert.deepEqual(migrated.missingColumns, [])
    assert.deepEqual(migrated.missingIndexes, [])

    await db.query('DROP INDEX idx_usage_log_quota_allocation')
    const missingIndex = await verifyResumeQuotaReservationSchema(db)
    assert.equal(missingIndex.ok, false)
    assert.deepEqual(missingIndex.missingIndexes, ['idx_usage_log_quota_allocation'])
  })

  await t.test('798 and 799 allow the remaining units while 800 rejects the next unit', async () => {
    await resetSchema(db)
    await migrateQuotaSchema(db)
    const { periodStart, periodEnd } = quotaPeriod()
    const userId = await seedUserAndUsage(db, 798, periodStart)

    const unit799 = await reserveResumeQuotaUnits({
      userId,
      periodStart,
      periodEnd,
      uploadLimit: 800,
      requestedUnits: 1,
      idempotencyKey: 'boundary-799',
    })
    assert.equal(unit799.reservation.requestedUnits, 1)

    const unit800 = await reserveResumeQuotaUnits({
      userId,
      periodStart,
      periodEnd,
      uploadLimit: 800,
      requestedUnits: 1,
      idempotencyKey: 'boundary-800',
    })
    assert.equal(unit800.reservation.requestedUnits, 1)

    await assert.rejects(
      reserveResumeQuotaUnits({
        userId,
        periodStart,
        periodEnd,
        uploadLimit: 800,
        requestedUnits: 1,
        idempotencyKey: 'boundary-801',
      }),
      ResumeQuotaExceededError,
    )
  })

  await t.test('16 simultaneous requests at 799 commit exactly unit 800', async () => {
    await resetSchema(db)
    await migrateQuotaSchema(db)
    const { periodStart, periodEnd } = quotaPeriod()
    const userId = await seedUserAndUsage(db, 799, periodStart)

    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, index) => reserveResumeQuotaUnits({
        userId,
        periodStart,
        periodEnd,
        uploadLimit: 800,
        requestedUnits: 1,
        idempotencyKey: `concurrent-unit-${index}`,
      })),
    )

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 15)
    assert.equal(rejected.every((result) => result.reason instanceof ResumeQuotaExceededError), true)

    const state = (await db.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM usage_log WHERE user_id = $1) AS used,
         COALESCE((SELECT SUM(requested_units)::integer
                   FROM resume_quota_reservations
                   WHERE user_id = $1 AND status = 'reserved'), 0) AS reserved`,
      [userId],
    )).rows[0]
    assert.deepEqual(state, { used: 799, reserved: 1 })
    assert.equal(state.used + state.reserved, 800)
  })

  await t.test('four overlapping five-unit batches at 790 never reserve beyond 800', async () => {
    await resetSchema(db)
    await migrateQuotaSchema(db)
    const { periodStart, periodEnd } = quotaPeriod()
    const userId = await seedUserAndUsage(db, 790, periodStart)

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) => reserveResumeQuotaUnits({
        userId,
        periodStart,
        periodEnd,
        uploadLimit: 800,
        requestedUnits: 5,
        idempotencyKey: `concurrent-batch-${index}`,
      })),
    )

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 2)
    const reserved = Number((await db.query(
      `SELECT COALESCE(SUM(requested_units), 0)::integer AS reserved
       FROM resume_quota_reservations
       WHERE user_id = $1 AND status = 'reserved'`,
      [userId],
    )).rows[0].reserved)
    assert.equal(reserved, 10)
    assert.equal(790 + reserved, 800)
  })

  await t.test('a new monthly period ignores historical usage without deleting it', async () => {
    await resetSchema(db)
    await migrateQuotaSchema(db)
    const { periodStart: oldPeriodStart, periodEnd: oldPeriodEnd } = quotaPeriod()
    const newPeriodStart = oldPeriodEnd
    const newPeriodEnd = new Date(Date.UTC(
      newPeriodStart.getUTCFullYear(),
      newPeriodStart.getUTCMonth() + 1,
      1,
    ))
    const userId = await seedUserAndUsage(db, 800, oldPeriodStart)

    const nextPeriod = await reserveResumeQuotaUnits({
      userId,
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      uploadLimit: 800,
      requestedUnits: 1,
      idempotencyKey: 'new-month-first-unit',
    })

    assert.equal(nextPeriod.used, 0)
    assert.equal(nextPeriod.reservation.requestedUnits, 1)
    assert.equal(Number((await db.query(
      'SELECT COUNT(*)::integer AS count FROM usage_log WHERE user_id = $1',
      [userId],
    )).rows[0].count), 800)
  })
})
