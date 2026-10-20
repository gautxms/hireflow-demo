export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_description_creation_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preview_id UUID NOT NULL,
      file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
      preview_sha256 TEXT NOT NULL CHECK (preview_sha256 ~ '^[a-f0-9]{64}$'),
      job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
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
}
