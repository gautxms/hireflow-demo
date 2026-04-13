export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, resume_id, tag)
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidate_tags_user_resume ON candidate_tags (user_id, resume_id)
  `)
}
