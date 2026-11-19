// Additive storage only. Google authentication is enabled in a later PR.
export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_login_enabled BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS terms_version TEXT
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_auth_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider <> ''),
      provider_subject TEXT NOT NULL CHECK (provider_subject <> ''),
      provider_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ,
      UNIQUE (provider, provider_subject),
      UNIQUE (user_id, provider)
    )
  `)
}
