export async function up(client) {
  await client.query(`
    ALTER TABLE paddle_webhook_events
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scheduler_attempt_count INTEGER NOT NULL DEFAULT 0
  `)

  // Rows with a persisted payload were written only after PR #1208's signature
  // boundary. Legacy duplicate-only rows have no payload and stay ineligible.
  await client.query(`
    UPDATE paddle_webhook_events
    SET verified_at = COALESCE(verified_at, first_received_at, created_at)
    WHERE payload IS NOT NULL
      AND verified_at IS NULL
  `)

  await client.query(`
    ALTER TABLE paddle_webhook_events
      DROP CONSTRAINT IF EXISTS paddle_webhook_events_status_check
  `)
  await client.query(`
    ALTER TABLE paddle_webhook_events
      ADD CONSTRAINT paddle_webhook_events_status_check
      CHECK (status IN ('processing', 'completed', 'retryable_failed', 'terminal_failed'))
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paddle_webhook_events_scheduled_retry
      ON paddle_webhook_events (paddle_environment, next_retry_at, last_attempt_at)
      WHERE status IN ('processing', 'retryable_failed') AND verified_at IS NOT NULL
  `)
}
