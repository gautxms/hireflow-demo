export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS resume_quota_allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reservation_id UUID NOT NULL
        REFERENCES resume_quota_reservations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      allocation_key TEXT NOT NULL,
      upload_id UUID,
      resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
      parse_job_id TEXT REFERENCES parse_jobs(job_id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'consumed', 'released')),
      provider TEXT,
      model TEXT,
      consumed_at TIMESTAMP,
      released_at TIMESTAMP,
      release_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, allocation_key)
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_resume_quota_allocations_reservation_status
      ON resume_quota_allocations (reservation_id, status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_quota_allocations_upload
      ON resume_quota_allocations (upload_id)
      WHERE upload_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_quota_allocations_parse_job
      ON resume_quota_allocations (parse_job_id)
      WHERE parse_job_id IS NOT NULL
  `)

  await client.query(`
    ALTER TABLE upload_chunks
      ADD COLUMN IF NOT EXISTS quota_allocation_id UUID
        REFERENCES resume_quota_allocations(id) ON DELETE SET NULL;

    ALTER TABLE parse_jobs
      ADD COLUMN IF NOT EXISTS quota_allocation_id UUID
        REFERENCES resume_quota_allocations(id) ON DELETE SET NULL;

    ALTER TABLE usage_log
      ADD COLUMN IF NOT EXISTS quota_allocation_id UUID
        REFERENCES resume_quota_allocations(id) ON DELETE SET NULL
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_log_quota_allocation
      ON usage_log (quota_allocation_id)
      WHERE quota_allocation_id IS NOT NULL
  `)

  await client.query(`
    INSERT INTO resume_quota_allocations
      (reservation_id, user_id, allocation_key, upload_id, resume_id, parse_job_id, status, consumed_at)
    SELECT
      quota_reservation_id,
      user_id,
      'upload:' || upload_id::text,
      upload_id,
      resume_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM parse_jobs AS existing_job
          WHERE existing_job.job_id = upload.parse_job_id
        ) THEN upload.parse_job_id
        ELSE NULL
      END,
      CASE WHEN quota_recorded THEN 'consumed' ELSE 'reserved' END,
      CASE WHEN quota_recorded THEN updated_at ELSE NULL END
    FROM upload_chunks AS upload
    WHERE quota_reservation_id IS NOT NULL
    ON CONFLICT (user_id, allocation_key) DO NOTHING
  `)

  await client.query(`
    UPDATE upload_chunks AS upload
    SET quota_allocation_id = allocation.id
    FROM resume_quota_allocations AS allocation
    WHERE upload.quota_allocation_id IS NULL
      AND allocation.user_id = upload.user_id
      AND allocation.upload_id = upload.upload_id
  `)

  await client.query(`
    UPDATE parse_jobs AS job
    SET quota_allocation_id = allocation.id
    FROM resume_quota_allocations AS allocation
    WHERE job.quota_allocation_id IS NULL
      AND allocation.parse_job_id = job.job_id
  `)
}
