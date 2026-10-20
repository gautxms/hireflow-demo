export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_description_creation_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preview_id UUID NOT NULL,
      file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
      preview_sha256 TEXT NOT NULL CHECK (preview_sha256 ~ '^[a-f0-9]{64}$'),
      file_url TEXT NOT NULL,
      job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'cleaning', 'deleting', 'deleted')),
      expires_at TIMESTAMPTZ NOT NULL,
      cleanup_attempted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      UNIQUE (user_id, preview_id)
    )
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_description_creation_requests_job
      ON job_description_creation_requests (job_description_id)
      WHERE job_description_id IS NOT NULL
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_job_description_creation_requests_expired
      ON job_description_creation_requests (expires_at, cleanup_attempted_at)
      WHERE status IN ('pending', 'cleaning', 'completed', 'deleting')
  `)
}
