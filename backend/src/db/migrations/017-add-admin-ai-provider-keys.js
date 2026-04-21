export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_provider_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      key_label TEXT NOT NULL CHECK (key_label IN ('primary', 'fallback')),
      api_key TEXT NOT NULL,
      model TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (provider, key_label)
    );
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_ai_provider_keys_provider
      ON admin_ai_provider_keys (provider, key_label);
  `)
}
