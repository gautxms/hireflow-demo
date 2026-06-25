function normalizeUsersIdType(typeName) {
  const normalized = String(typeName || '').trim().toLowerCase()

  if (normalized === 'uuid') return 'uuid'
  if (normalized === 'integer' || normalized === 'int4') return 'integer'
  if (normalized === 'bigint' || normalized === 'int8') return 'bigint'

  throw new Error(`[Migration 039] Unsupported users.id type: ${typeName}`)
}

async function getUsersIdType(client) {
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
    throw new Error('[Migration 039] users.id column not found')
  }

  return normalizeUsersIdType(result.rows[0].data_type)
}

export async function up(client) {
  const usersIdType = await getUsersIdType(client)

  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')

  await client.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id ${usersIdType} REFERENCES users(id) ON DELETE SET NULL,
      paddle_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      latest_event_type TEXT,
      latest_event_payload JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await client.query(`
    ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS user_id ${usersIdType} REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'inactive',
      ADD COLUMN IF NOT EXISTS latest_event_type TEXT,
      ADD COLUMN IF NOT EXISTS latest_event_payload JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_created
      ON subscriptions (user_id, created_at DESC)
  `)
}
