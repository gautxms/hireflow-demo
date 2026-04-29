export async function up(pool) {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_analyses_user_created_at
      ON analyses (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_analyses_user_job_created_at
      ON analyses (user_id, job_description_id, created_at DESC)
      WHERE job_description_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_resumes_user_created_at
      ON resumes (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_shortlist_candidates_added_at_shortlist
      ON shortlist_candidates (added_at DESC, shortlist_id, resume_id);

    CREATE INDEX IF NOT EXISTS idx_shortlists_user_id_id
      ON shortlists (user_id, id);
  `)
}
