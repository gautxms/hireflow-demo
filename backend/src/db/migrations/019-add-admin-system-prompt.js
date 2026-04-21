export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_system_prompts (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
      system_prompt TEXT NOT NULL,
      prompt_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_version >= 1),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)
}
