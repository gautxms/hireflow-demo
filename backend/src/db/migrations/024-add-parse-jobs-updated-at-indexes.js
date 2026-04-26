export async function up(pool) {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_parse_jobs_updated_at
      ON parse_jobs (updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_parse_jobs_resume_id_updated_at
      ON parse_jobs (resume_id, updated_at DESC);
  `)
}
