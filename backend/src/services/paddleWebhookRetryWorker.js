import { pool } from '../db/client.js'
import {
  PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS,
  processStoredPaddleWebhookEvent,
} from '../routes/paddleWebhook.js'

export const DEFAULT_PADDLE_WEBHOOK_RETRY_BATCH_SIZE = 20
export const PADDLE_WEBHOOK_RETRY_INTERVAL_MS = 60_000

export function isPaddleWebhookRetryWorkerEnabled(env = process.env) {
  return String(env.PADDLE_WEBHOOK_RETRY_WORKER_ENABLED || '').trim().toLowerCase() === 'true'
}

function batchSize(env) {
  const configured = Number.parseInt(env.PADDLE_WEBHOOK_RETRY_BATCH_SIZE || '', 10)
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, 100)
    : DEFAULT_PADDLE_WEBHOOK_RETRY_BATCH_SIZE
}

export async function runPaddleWebhookRetryWorker(dependencies = {}) {
  const db = dependencies.db || pool
  const env = dependencies.env || process.env
  const processEvent = dependencies.processEvent || processStoredPaddleWebhookEvent
  const summary = {
    scanned: 0, claimed: 0, completed: 0, retryable_failed: 0,
    terminal_failed: 0, skipped: 0, ownership_lost: 0,
  }
  if (!isPaddleWebhookRetryWorkerEnabled(env)) return summary

  console.info('[Paddle webhook retry] run started', { batchSize: batchSize(env) })

  const exhausted = await db.query(
    `UPDATE paddle_webhook_events
     SET status = 'terminal_failed', next_retry_at = NULL, failed_at = COALESCE(failed_at, NOW()),
         last_error_code = 'SCHEDULER_ATTEMPTS_EXHAUSTED',
         last_error_message = 'Scheduled webhook retry limit exhausted'
     WHERE status = 'retryable_failed'
       AND verified_at IS NOT NULL
       AND COALESCE(scheduler_attempt_count, 0) >= $1`,
    [PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS],
  )
  summary.terminal_failed += exhausted.rowCount

  const candidates = await db.query(
    `SELECT event_id, event_type, payload_hash, payload, paddle_environment, verified_at,
            status, attempt_count, scheduler_attempt_count
     FROM paddle_webhook_events
     WHERE verified_at IS NOT NULL
       AND paddle_environment IN ('production', 'sandbox')
       AND (
         (status = 'retryable_failed' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND COALESCE(scheduler_attempt_count, 0) < $1)
         OR
         (status = 'processing' AND (last_attempt_at IS NULL OR last_attempt_at <= NOW() - INTERVAL '120 seconds'))
       )
     ORDER BY COALESCE(next_retry_at, last_attempt_at, first_received_at) ASC
     LIMIT $2`,
    [PADDLE_WEBHOOK_SCHEDULER_MAX_ATTEMPTS, batchSize(env)],
  )
  summary.scanned = candidates.rowCount

  for (const event of candidates.rows) {
    try {
      const result = await processEvent(event)
      if (result.outcome === 'completed') {
        summary.claimed += 1
        summary.completed += 1
      } else if (result.outcome === 'ownership_lost') {
        summary.ownership_lost += 1
      } else if (result.outcome === 'skipped') {
        summary.skipped += 1
      } else {
        summary.claimed += 1
        const state = await db.query(
          'SELECT status FROM paddle_webhook_events WHERE event_id = $1 AND paddle_environment = $2',
          [event.event_id, event.paddle_environment],
        )
        const status = state.rows[0]?.status
        if (status === 'terminal_failed') summary.terminal_failed += 1
        else summary.retryable_failed += 1
      }
    } catch (error) {
      summary.skipped += 1
      console.error('[Paddle webhook retry] candidate failed', {
        eventId: event.event_id,
        eventType: event.event_type,
        environment: event.paddle_environment,
        errorCode: error?.code || error?.name || 'UNKNOWN_ERROR',
      })
    }
  }

  console.info('[Paddle webhook retry] run completed', summary)
  return summary
}

export function startPaddleWebhookRetryWorker(env = process.env) {
  if (!isPaddleWebhookRetryWorkerEnabled(env)) {
    console.info('[Paddle webhook retry] worker disabled')
    return null
  }
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await runPaddleWebhookRetryWorker({ env })
    } catch (error) {
      console.error('[Paddle webhook retry] run failed', { errorCode: error?.code || error?.name || 'UNKNOWN_ERROR' })
    } finally {
      running = false
    }
  }
  const timer = setInterval(run, PADDLE_WEBHOOK_RETRY_INTERVAL_MS)
  timer.unref?.()
  void run()
  console.info('[Paddle webhook retry] worker scheduled', { intervalMs: PADDLE_WEBHOOK_RETRY_INTERVAL_MS })
  return timer
}
