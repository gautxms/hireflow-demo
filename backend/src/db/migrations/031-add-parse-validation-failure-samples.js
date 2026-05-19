export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parse_validation_failure_samples (
      id BIGSERIAL PRIMARY KEY,
      resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
      parse_job_id TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      provider TEXT,
      model TEXT,
      failure_reason TEXT NOT NULL,
      sample_snippet TEXT NOT NULL,
      sample_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_parse_validation_failure_samples_reason_created
      ON parse_validation_failure_samples (failure_reason, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_parse_validation_failure_samples_expires_at
      ON parse_validation_failure_samples (expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parse_validation_failure_samples_dedupe
      ON parse_validation_failure_samples (failure_reason, sample_hash);
  `)
}

