export async function up(pool) {
  await pool.query(`
    ALTER TABLE shortlists
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))
  `)

  await pool.query(`
    ALTER TABLE shortlists
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_shortlists_user_status_created_at
    ON shortlists (user_id, status, created_at DESC)
  `)
}
