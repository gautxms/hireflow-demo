export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_settings (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
      active_provider TEXT NOT NULL DEFAULT 'anthropic',
      settings_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    INSERT INTO admin_ai_settings (id, active_provider)
    VALUES (true, 'anthropic')
    ON CONFLICT (id) DO NOTHING;
  `)

  await pool.query(`
    ALTER TABLE admin_ai_provider_keys
      DROP CONSTRAINT IF EXISTS chk_admin_ai_provider_keys_provider;
  `)

  await pool.query(`
    ALTER TABLE admin_ai_provider_keys
      ADD CONSTRAINT chk_admin_ai_provider_keys_provider
      CHECK (provider IN ('anthropic', 'openai')) NOT VALID;
  `)

  await pool.query(`
    ALTER TABLE admin_ai_provider_keys
      VALIDATE CONSTRAINT chk_admin_ai_provider_keys_provider;
  `)

  await pool.query(`
    ALTER TABLE admin_ai_settings
      DROP CONSTRAINT IF EXISTS chk_admin_ai_settings_active_provider;
  `)

  await pool.query(`
    ALTER TABLE admin_ai_settings
      ADD CONSTRAINT chk_admin_ai_settings_active_provider
      CHECK (active_provider IN ('anthropic', 'openai')) NOT VALID;
  `)

  await pool.query(`
    ALTER TABLE admin_ai_settings
      VALIDATE CONSTRAINT chk_admin_ai_settings_active_provider;
  `)
}
