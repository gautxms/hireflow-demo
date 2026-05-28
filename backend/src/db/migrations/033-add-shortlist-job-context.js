export async function up(pool) {
  await pool.query(`
    ALTER TABLE shortlists
      ADD COLUMN IF NOT EXISTS job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL
  `)

  await pool.query(`
    ALTER TABLE shortlist_candidates
      ADD COLUMN IF NOT EXISTS source_context JSONB
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_shortlists_job_description_id
      ON shortlists (job_description_id)
  `)
}
