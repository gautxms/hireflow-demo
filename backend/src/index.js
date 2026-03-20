import 'dotenv/config'
import app from './server.js'
import { runMigrations } from './db/migrate.js'
import { ensurePasswordResetTables, ensurePaymentTrackingTables, pool } from './db/client.js'
import { retryFailedPayments } from './services/paymentRetry.js'
import { archiveOldErrorLogs, initErrorTracking } from './services/errorTracking.js'

const port = process.env.PORT || 4000
const PAYMENT_RETRY_CRON_MS = 15 * 60 * 1000
const ERROR_ARCHIVE_CRON_MS = 24 * 60 * 60 * 1000

function startPaymentRetryCron() {
  const runPaymentRetry = async () => {
    try {
      const retriedCount = await retryFailedPayments()

      if (retriedCount > 0) {
        console.log(`[Payment Retry] Processed ${retriedCount} due payment attempt(s)`)
      }
    } catch (error) {
      console.error('[Payment Retry] Cron execution failed:', error)
    }
  }

  setInterval(runPaymentRetry, PAYMENT_RETRY_CRON_MS)
  void runPaymentRetry()

  console.log('[Payment Retry] Cron job scheduled (every 15 minutes)')
}

function startErrorArchiveCron() {
  const runArchive = async () => {
    try {
      await archiveOldErrorLogs()
    } catch (error) {
      console.error('[Error Tracking] Archive job failed:', error)
    }
  }

  setInterval(runArchive, ERROR_ARCHIVE_CRON_MS)
  void runArchive()
}

async function ensureErrorLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      error_type TEXT NOT NULL,
      source TEXT NOT NULL,
      endpoint TEXT,
      method TEXT,
      status_code INTEGER NOT NULL DEFAULT 500,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      stack TEXT,
      request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      sentry_event_id TEXT,
      error_fingerprint TEXT NOT NULL,
      alert_sent BOOLEAN NOT NULL DEFAULT false,
      archived_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
      ON error_logs (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_error_logs_type_endpoint
      ON error_logs (error_type, endpoint, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_error_logs_fingerprint
      ON error_logs (error_fingerprint, created_at DESC);
  `)
}

async function start() {
  try {
    await initErrorTracking()

    await runMigrations()
    await ensurePasswordResetTables()
    await ensurePaymentTrackingTables()
    await ensureErrorLogTable()

    startPaymentRetryCron()
    startErrorArchiveCron()

    app.listen(port, () => {
      console.log(`✓ Backend listening on port ${port}`)
    })
  } catch (error) {
    console.error('[Startup] Fatal error:', error)
    process.exit(1)
  }
}

start()
