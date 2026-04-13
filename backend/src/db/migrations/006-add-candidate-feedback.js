export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL CHECK (feedback_type IN ('helpful', 'unhelpful', 'flag_false_positive', 'flag_missing')),
      comment TEXT,
      sentiment_label TEXT NOT NULL DEFAULT 'neutral',
      sentiment_score INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      feedback_date DATE GENERATED ALWAYS AS (created_at::date) STORED
    )
  `)

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_feedback_daily_unique ON candidate_feedback (user_id, candidate_id, feedback_date);
    CREATE INDEX IF NOT EXISTS idx_candidate_feedback_created_at ON candidate_feedback (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_candidate_feedback_type_created_at ON candidate_feedback (feedback_type, created_at DESC);
  `)
}
