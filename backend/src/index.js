import 'dotenv/config'
import app from './server.js'
import { runMigrations } from './db/migrate.js'
import { initializeDatabase, ensurePasswordResetTables, ensurePaymentTrackingTables, pool } from './db/client.js'
import { runRecoveryBillingAdjustments } from './services/recoveryBillingAdjustment.js'
import { startPaddleWebhookRetryWorker } from './services/paddleWebhookRetryWorker.js'
import { startAnalyticsCron } from './services/analytics.js'
import { logEmailConfigStatus } from './services/emailService.js'
import { initializeJobQueue } from './services/jobQueue.js'
import { registerParseResumeJobProcessor } from './jobs/parseResumeJob.js'
import { startChunkUploadCleanupCron } from './services/fileUploadService.js'
import { ensureWebhookTables } from './services/webhookService.js'
import { ensureNotificationTables } from './services/notificationService.js'
import { validateAiProviderModelConfiguration } from './services/aiProviderConfigService.js'
import { alignAdminAiUserReferenceColumns, verifyAdminAiUserReferenceCompatibility } from './services/adminAiSchemaCompatibility.js'
import { verifyYearsExperienceDecimalSchema, verifyShortlistBatchAddSchema } from './db/schemaPrerequisites.js'
import {
  assertPaddleBillingPrerequisites,
  setPaddleWebhookWorkerState,
} from './services/paddleBillingReadiness.js'

const port = process.env.PORT || 4000
const RECOVERY_BILLING_ADJUSTMENT_CRON_MS = 15 * 60 * 1000

function startRecoveryBillingAdjustmentCron() {
  const runRecoveryAdjustment = async () => {
    try {
      const adjustmentCount = await runRecoveryBillingAdjustments()

      if (adjustmentCount > 0) console.log(`[Recovery Billing] Processed ${adjustmentCount} adjustment candidate(s)`)
    } catch (error) {
      console.error('[Recovery Billing] Cron execution failed:', error)
    }
  }

  setInterval(runRecoveryAdjustment, RECOVERY_BILLING_ADJUSTMENT_CRON_MS)
  void runRecoveryAdjustment()

  console.log('[Recovery Billing] Cron job scheduled (every 15 minutes)')
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
    const dashboardSchemaResult = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'resumes'
           AND column_name = 'profile_score'
       ) AS has_profile_score`,
    )
    const hasProfileScoreColumn = Boolean(dashboardSchemaResult.rows[0]?.has_profile_score)
    if (!hasProfileScoreColumn) {
      throw new Error('[Startup] Missing migration prerequisite: resumes.profile_score column is required for dashboard KPIs')
    }
    console.log('[Startup] Migration prerequisite confirmed: resumes.profile_score')

    const yearsExperienceSchema = await verifyYearsExperienceDecimalSchema()
    if (!yearsExperienceSchema.ok) {
      throw new Error(
        `[Startup] Missing migration prerequisite: resumes.years_experience must be NUMERIC(5,2). Actual=${JSON.stringify(yearsExperienceSchema.actual || {})}`,
      )
    }
    console.log('[Startup] Migration prerequisite confirmed: resumes.years_experience NUMERIC(5,2)')
    const shortlistBatchSchema = await verifyShortlistBatchAddSchema()
    if (!shortlistBatchSchema.ok) {
      throw new Error(
        `[Startup] Missing migration prerequisite: shortlist_candidates batch-add columns invalid: ${JSON.stringify(shortlistBatchSchema.issues)}`,
      )
    }
    console.log('[Startup] Migration prerequisite confirmed: shortlist_candidates batch-add metadata columns')
    const paddleBillingReadiness = await assertPaddleBillingPrerequisites({ db: pool })
    if (paddleBillingReadiness.enabled) {
      console.log('[Startup] Paddle durable webhook configuration and schema confirmed', {
        environments: paddleBillingReadiness.environments,
      })
    } else {
      console.log('[Startup] Paddle billing is not configured; durable webhook worker is not required')
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

    await startPaddleWebhookRetryWorker(process.env, {
      db: pool,
      onStateChange: setPaddleWebhookWorkerState,
    })
    startRecoveryBillingAdjustmentCron()
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
