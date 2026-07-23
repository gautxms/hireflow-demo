export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS resume_quota_reservations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      period_start TIMESTAMP NOT NULL,
      period_end TIMESTAMP NOT NULL,
      requested_units INTEGER NOT NULL CHECK (requested_units > 0),
      consumed_units INTEGER NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
      released_units INTEGER NOT NULL DEFAULT 0 CHECK (released_units >= 0),
      status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'consumed', 'released')),
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, idempotency_key),
      CHECK (period_end > period_start),
      CHECK (consumed_units + released_units <= requested_units)
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_resume_quota_reservations_availability
      ON resume_quota_reservations (user_id, period_start, period_end, status, expires_at)
  `)

  await client.query(`
    ALTER TABLE upload_chunks
      ADD COLUMN IF NOT EXISTS quota_reservation_id UUID
        REFERENCES resume_quota_reservations(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS quota_recorded BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS file_identity TEXT
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_chunks_active_file_identity
      ON upload_chunks (user_id, file_identity)
      WHERE file_identity IS NOT NULL
        AND status = 'uploading'
  `)

  await client.query(`
    UPDATE upload_chunks
    SET quota_recorded = true
    WHERE quota_recorded = false
      AND created_at < NOW()
  `)

  await client.query(`
    UPDATE users
    SET quota_anchor_at = NULL
    WHERE quota_anchor_at IS NOT NULL
      AND current_period_end IS NOT NULL
      AND quota_anchor_at = current_period_end
      AND EXTRACT(DAY FROM current_period_end) < 31
      AND EXTRACT(DAY FROM current_period_end) =
          EXTRACT(DAY FROM (DATE_TRUNC('month', current_period_end) + INTERVAL '1 month - 1 day'))
  `)
}
