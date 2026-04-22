function normalizeUsersIdType(typeName) {
  const normalized = String(typeName || '').trim().toLowerCase()

  if (normalized === 'uuid') return 'uuid'
  if (normalized === 'integer' || normalized === 'int4') return 'integer'
  if (normalized === 'bigint' || normalized === 'int8') return 'bigint'

  throw new Error(`[Migration 019] Unsupported users.id type: ${typeName}`)
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
    throw new Error('[Migration 019] users.id column not found')
  }

  return normalizeUsersIdType(result.rows[0].data_type)
}

export async function up(pool) {
  const usersIdType = await getUsersIdReferenceType(pool)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_system_prompts (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
      system_prompt TEXT NOT NULL,
      prompt_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_version >= 1),
      updated_by ${usersIdType} REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)
}
