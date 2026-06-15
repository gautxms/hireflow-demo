export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_score_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key TEXT UNIQUE NOT NULL,
      cache_key_version TEXT NOT NULL,
      scoring_contract_version TEXT NOT NULL,
      canonical_score NUMERIC NOT NULL,
      score_out_of_ten NUMERIC NOT NULL,
      canonical_score_source TEXT,
      canonical_score_context TEXT,
      provider TEXT,
      model TEXT,
      prompt_version TEXT,
      compact_mode TEXT,
      resume_fingerprint TEXT NOT NULL,
      job_description_fingerprint TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMP,
      hit_count INTEGER NOT NULL DEFAULT 0
    )
  `)

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_score_cache_cache_key
      ON ai_score_cache(cache_key);
    CREATE INDEX IF NOT EXISTS idx_ai_score_cache_resume_fingerprint
      ON ai_score_cache(resume_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_ai_score_cache_job_description_fingerprint
      ON ai_score_cache(job_description_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_ai_score_cache_created_at
      ON ai_score_cache(created_at DESC);
  `)
}
