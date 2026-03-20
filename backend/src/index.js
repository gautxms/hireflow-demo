import 'dotenv/config'
import rateLimit from 'express-rate-limit'
import app from './server.js'
import passwordResetRoutes from './routes/passwordReset.js'
import { runMigrations } from './db/migrate.js'
import { ensurePaymentTrackingTables } from './config/db.js'
import { paymentRetryJob } from './jobs/paymentRetryJob.js'

const port = process.env.PORT || 4000
const PAYMENT_RETRY_CRON_MS = 60 * 60 * 1000

function startPaymentRetryCron() {
  setInterval(() => {
    paymentRetryJob().catch((error) => {
      console.error('[JOB] Payment retry failed:', error)
    })
  }, PAYMENT_RETRY_CRON_MS)

  console.log('[JOB] ✓ Payment retry job scheduled (hourly)')
}

app.use('/api/password-reset', passwordResetRoutes)

const uploadIpRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many upload attempts',
    message: 'This IP has reached the daily upload request limit. Please try again tomorrow.',
  },
})

app.use('/api/uploads', uploadIpRateLimit)

async function start() {
  try {
    // Run database migrations first
    await runMigrations()
    await ensurePaymentTrackingTables()

    // Then start the server
    app.listen(port, () => {
      console.log(`✓ Backend listening on port ${port}`)
    })

    startPaymentRetryCron()
  } catch (error) {
    console.error('[Startup] Fatal error:', error)
    process.exit(1)
  }
}

start()
