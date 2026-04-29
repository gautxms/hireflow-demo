import 'dotenv/config'
import app from './server.js'
import { runMigrations } from './db/migrate.js'
import { initializeDatabase, ensurePasswordResetTables, ensurePaymentTrackingTables } from './db/client.js'
import { retryFailedPayments } from './services/paymentRetry.js'
import { startAnalyticsCron } from './services/analytics.js'
import { logEmailConfigStatus } from './services/emailService.js'
import { initializeJobQueue } from './services/jobQueue.js'
import { registerParseResumeJobProcessor } from './jobs/parseResumeJob.js'
import { startChunkUploadCleanupCron } from './services/fileUploadService.js'
import { ensureWebhookTables } from './services/webhookService.js'
import { ensureNotificationTables } from './services/notificationService.js'
import { validateAiProviderModelConfiguration } from './services/aiProviderConfigService.js'
import { alignAdminAiUserReferenceColumns, verifyAdminAiUserReferenceCompatibility } from './services/adminAiSchemaCompatibility.js'

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
    await initializeDatabase()
    await runMigrations()
    await ensurePasswordResetTables()
    await ensurePaymentTrackingTables()
    await ensureWebhookTables()
    await ensureNotificationTables()
    const adminAiSchemaAlignment = await alignAdminAiUserReferenceColumns()
    console.log(`[Startup] Admin AI users.id type detected: ${adminAiSchemaAlignment.usersIdType}`)
    console.log(
      `[Startup] Admin AI columns aligned: ${adminAiSchemaAlignment.alignedColumns.length > 0 ? adminAiSchemaAlignment.alignedColumns.join(', ') : 'none'}`,
    )

    const adminAiSchemaHealth = await verifyAdminAiUserReferenceCompatibility()
    if (!adminAiSchemaHealth.ok) {
      console.error('[Startup] Admin AI schema compatibility issues remain after alignment:', adminAiSchemaHealth.issues)
      throw new Error(
        `[Startup] Admin AI schema compatibility check failed for users.id (${adminAiSchemaHealth.usersIdType}): ${adminAiSchemaHealth.issues.join('; ')}`,
      )
    }
    await initializeJobQueue()

    logEmailConfigStatus()

    const aiModelConfig = await validateAiProviderModelConfiguration()
    if (aiModelConfig.warnings.length > 0) {
      console.warn('[AI Model Config] Unsupported model configuration detected.', {
        allowedModels: aiModelConfig.allowedModels,
        warnings: aiModelConfig.warnings,
      })
    }

    registerParseResumeJobProcessor()

    startPaymentRetryCron()
    startAnalyticsCron()
    startChunkUploadCleanupCron()

    app.listen(port, () => {
      console.log(`✓ Backend listening on port ${port}`)
      console.log('[RateLimit] In-memory rate limits enabled. Localhost IPs are whitelisted.')
    })
  } catch (error) {
    console.error('[Startup] Fatal error:', error)
    process.exit(1)
  }
}

start()
