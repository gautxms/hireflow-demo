export async function up(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

  await client.query(`
    CREATE TABLE IF NOT EXISTS paddle_webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT,
      payload_hash TEXT NOT NULL,
      payload JSONB,
      paddle_environment TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      attempt_count INTEGER NOT NULL DEFAULT 1,
      first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_attempt_at TIMESTAMPTZ,
      processed_at TIMESTAMP,
      completed_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      next_retry_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    ALTER TABLE paddle_webhook_events
      ADD COLUMN IF NOT EXISTS payload JSONB,
      ADD COLUMN IF NOT EXISTS paddle_environment TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
      ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_error_code TEXT,
      ADD COLUMN IF NOT EXISTS last_error_message TEXT
  `)

  await client.query(`
    ALTER TABLE paddle_webhook_events
      ALTER COLUMN processed_at DROP NOT NULL,
      ALTER COLUMN processed_at DROP DEFAULT
  `)

  await client.query(`
    UPDATE paddle_webhook_events
    SET status = 'completed',
        completed_at = COALESCE(completed_at, processed_at, created_at),
        first_received_at = COALESCE(first_received_at, created_at),
        last_attempt_at = COALESCE(last_attempt_at, processed_at, created_at),
        attempt_count = GREATEST(COALESCE(attempt_count, 1), 1)
    WHERE status IS NULL
       OR status = 'completed'
  `)

  await client.query(`
    ALTER TABLE paddle_webhook_events
      DROP CONSTRAINT IF EXISTS paddle_webhook_events_status_check
  `)
  await client.query(`
    ALTER TABLE paddle_webhook_events
      ADD CONSTRAINT paddle_webhook_events_status_check
      CHECK (status IN ('processing', 'completed', 'retryable_failed'))
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paddle_webhook_events_created_at
      ON paddle_webhook_events (created_at DESC)
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paddle_webhook_events_retryable
      ON paddle_webhook_events (status, next_retry_at, last_attempt_at)
      WHERE status IN ('processing', 'retryable_failed')
  `)
}
