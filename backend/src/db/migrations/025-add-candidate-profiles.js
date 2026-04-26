export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      profile JSONB NOT NULL,
      source_parse_job_id TEXT,
      source_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      schema_version TEXT NOT NULL DEFAULT 'v1',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, resume_id)
    );

    CREATE INDEX IF NOT EXISTS idx_candidate_profiles_user_id
      ON candidate_profiles (user_id);

    CREATE INDEX IF NOT EXISTS idx_candidate_profiles_source_updated_at
      ON candidate_profiles (source_updated_at DESC);
  `)

  await pool.query(`
    INSERT INTO candidate_profiles (
      user_id,
      resume_id,
      profile,
      source_parse_job_id,
      source_updated_at,
      schema_version
    )
    SELECT
      r.user_id,
      r.id,
      COALESCE((r.parse_result->'candidates'->0), (pj.result->'candidates'->0)) AS profile,
      pj.job_id,
      COALESCE(pj.updated_at, r.updated_at, NOW()) AS source_updated_at,
      'v1' AS schema_version
    FROM resumes r
    LEFT JOIN LATERAL (
      SELECT job_id, result, updated_at
      FROM parse_jobs
      WHERE resume_id = r.id
        AND user_id = r.user_id
        AND status = 'complete'
      ORDER BY updated_at DESC
      LIMIT 1
    ) pj ON TRUE
    WHERE COALESCE((r.parse_result->'candidates'->0), (pj.result->'candidates'->0)) IS NOT NULL
    ON CONFLICT (user_id, resume_id) DO UPDATE SET
      profile = EXCLUDED.profile,
      source_parse_job_id = EXCLUDED.source_parse_job_id,
      source_updated_at = EXCLUDED.source_updated_at,
      schema_version = EXCLUDED.schema_version,
      updated_at = NOW();
  `)
}
