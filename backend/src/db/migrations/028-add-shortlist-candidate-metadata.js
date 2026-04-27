export async function up(pool) {
  await pool.query(`
    ALTER TABLE shortlist_candidates
      ADD COLUMN IF NOT EXISTS analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS candidate_snapshot JSONB,
      ADD COLUMN IF NOT EXISTS decision_status TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `)

  await pool.query(`
    UPDATE shortlist_candidates
    SET created_at = COALESCE(created_at, added_at, NOW()),
        updated_at = COALESCE(updated_at, added_at, NOW())
    WHERE created_at IS NULL OR updated_at IS NULL
  `)

  await pool.query(`
    ALTER TABLE shortlist_candidates
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET NOT NULL
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_shortlist_candidates_analysis_id
      ON shortlist_candidates (analysis_id)
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_shortlist_candidates_decision_status
      ON shortlist_candidates (decision_status)
  `)
}
