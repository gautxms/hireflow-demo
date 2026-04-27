export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      schedule_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT report_definitions_owner_name_unique UNIQUE (user_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_report_definitions_user_id_updated_at
      ON report_definitions (user_id, updated_at DESC);
  `)
}
