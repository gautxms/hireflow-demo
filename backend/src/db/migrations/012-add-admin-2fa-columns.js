export async function up(client) {
  // Add admin 2FA columns if they don't exist
  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_two_factor_enabled BOOLEAN DEFAULT false;
  `)

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_two_factor_secret_enc TEXT;
  `)

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_backup_codes JSONB DEFAULT '[]'::jsonb;
  `)

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_eula_accepted_at TIMESTAMP;
  `)

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_last_login_at TIMESTAMP;
  `)

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_last_login_ip TEXT;
  `)

  // Create index for admin login tracking
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_last_login ON users(admin_last_login_at) WHERE is_admin = true;
  `)

  console.log('[Migration] Added admin 2FA columns to users table')
}
