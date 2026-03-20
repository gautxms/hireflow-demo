import { logErrorToDatabase } from '../db/client.js'
import { alertSupportIfHighFailureVolume, retryFailedPayments } from '../services/paymentRetry.js'

export async function paymentRetryJob() {
  console.log('[JOB] Starting payment retry job...')

  try {
    const retriedCount = await retryFailedPayments()
    console.log(`[JOB] Payment retry job completed. Processed ${retriedCount} due payment attempt(s).`)

    await alertSupportIfHighFailureVolume()
  } catch (error) {
    console.error('[JOB] Payment retry job error:', error.message)
    await logErrorToDatabase('payment.retry.job_failed', error)
  }
}
