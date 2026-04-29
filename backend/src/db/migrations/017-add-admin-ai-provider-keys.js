function normalizeUsersIdType(typeName) {
  const normalized = String(typeName || '').trim().toLowerCase()

  if (normalized === 'uuid') return 'uuid'
  if (normalized === 'integer' || normalized === 'int4') return 'integer'
  if (normalized === 'bigint' || normalized === 'int8') return 'bigint'

  throw new Error(`[Migration 017] Unsupported users.id type: ${typeName}`)
}

async function getUsersIdReferenceType(client) {
  const result = await client.query(`
    SELECT format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = 'users'
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1
  `)

  if (result.rows.length === 0) {
    throw new Error('[Migration 017] users.id column not found')
  }

  return normalizeUsersIdType(result.rows[0].data_type)
}

export async function up(pool) {
  const usersIdType = await getUsersIdReferenceType(pool)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_provider_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      key_label TEXT NOT NULL CHECK (key_label IN ('primary', 'fallback')),
      api_key TEXT NOT NULL,
      model TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by ${usersIdType} REFERENCES users(id) ON DELETE SET NULL,
      updated_by ${usersIdType} REFERENCES users(id) ON DELETE SET NULL,
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
