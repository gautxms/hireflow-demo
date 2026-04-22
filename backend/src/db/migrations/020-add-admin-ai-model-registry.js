function parseModelList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)))
}

export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_model_registry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      display_name TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (provider, model_id)
    );
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_ai_model_registry_provider
      ON admin_ai_model_registry (provider, status, model_id);
  `)

  const anthropicDefault = String(process.env.ANTHROPIC_RESUME_MODEL || '').trim() || 'claude-sonnet-4-20250514'
  const openaiDefault = String(process.env.OPENAI_RESUME_MODEL || '').trim() || 'gpt-4o-mini'
  const anthropicSeeds = unique([...parseModelList(process.env.ANTHROPIC_ALLOWED_MODELS), anthropicDefault])
  const openaiSeeds = unique([...parseModelList(process.env.OPENAI_ALLOWED_MODELS), openaiDefault])

  for (const modelId of anthropicSeeds) {
    await pool.query(
      `INSERT INTO admin_ai_model_registry (provider, model_id, status, display_name, metadata, source)
       VALUES ('anthropic', $1, 'active', $1, '{}'::jsonb, 'env_seed')
       ON CONFLICT (provider, model_id) DO NOTHING`,
      [modelId],
    )
  }

  for (const modelId of openaiSeeds) {
    await pool.query(
      `INSERT INTO admin_ai_model_registry (provider, model_id, status, display_name, metadata, source)
       VALUES ('openai', $1, 'active', $1, '{}'::jsonb, 'env_seed')
       ON CONFLICT (provider, model_id) DO NOTHING`,
      [modelId],
    )
  }
}
