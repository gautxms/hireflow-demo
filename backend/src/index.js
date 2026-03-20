import 'dotenv/config'
import app from './server.js'
import { runMigrations } from './db/migrate.js'
import { ensurePasswordResetTables, ensurePaymentTrackingTables } from './db/client.js'
import { retryFailedPayments } from './services/paymentRetry.js'
import { startAnalyticsCron } from './services/analytics.js'

const port = process.env.PORT || 4000
const PAYMENT_RETRY_CRON_MS = 15 * 60 * 1000

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

async function start() {
  try {
    await runMigrations()
    await ensurePasswordResetTables()
    await ensurePaymentTrackingTables()

    startPaymentRetryCron()
    startAnalyticsCron()

    app.listen(port, () => {
      console.log(`✓ Backend listening on port ${port}`)
    })
  } catch (error) {
    console.error('[Startup] Fatal error:', error)
    process.exit(1)
  }
}

start()
