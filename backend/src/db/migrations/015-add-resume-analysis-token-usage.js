export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_analysis_token_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      parse_job_id TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      job_description_id UUID,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      model TEXT,
      usage_available BOOLEAN NOT NULL DEFAULT false,
      unavailable_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost_usd NUMERIC(12, 6),
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_resume_token_usage_resume_id
      ON resume_analysis_token_usage (resume_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resume_token_usage_created_at
      ON resume_analysis_token_usage (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resume_token_usage_user_id
      ON resume_analysis_token_usage (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resume_token_usage_parse_job_id
      ON resume_analysis_token_usage (parse_job_id);
  `)
}
