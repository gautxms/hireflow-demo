export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mcp_profile_id UUID DEFAULT gen_random_uuid()
  `)

  await client.query(`
    UPDATE users
    SET mcp_profile_id = gen_random_uuid()
    WHERE mcp_profile_id IS NULL
  `)

  await client.query(`
    ALTER TABLE users
      ALTER COLUMN mcp_profile_id SET DEFAULT gen_random_uuid(),
      ALTER COLUMN mcp_profile_id SET NOT NULL
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mcp_profile_id
      ON users (mcp_profile_id)
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT[] NOT NULL,
      resource TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_codes_expiry
      ON mcp_oauth_authorization_codes (expires_at)
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      access_token_hash TEXT NOT NULL UNIQUE CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
      refresh_token_hash TEXT NOT NULL UNIQUE CHECK (refresh_token_hash ~ '^[a-f0-9]{64}$'),
      scope TEXT[] NOT NULL,
      resource TEXT NOT NULL,
      access_expires_at TIMESTAMPTZ NOT NULL,
      refresh_expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_user
      ON mcp_oauth_tokens (user_id, created_at DESC)
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_refresh_expiry
      ON mcp_oauth_tokens (refresh_expires_at)
      WHERE revoked_at IS NULL
  `)
}
