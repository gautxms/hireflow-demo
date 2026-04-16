export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_page_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      route TEXT NOT NULL,
      is_useful BOOLEAN NOT NULL,
      comment TEXT,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_page_feedback_created_at ON admin_page_feedback (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_page_feedback_route_created_at ON admin_page_feedback (route, created_at DESC);
  `)
}
