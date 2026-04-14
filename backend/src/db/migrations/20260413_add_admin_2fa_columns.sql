-- Add admin 2FA columns if they don't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_two_factor_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_backup_codes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_eula_accepted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_last_login_ip TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_last_login ON users(admin_last_login_at) WHERE is_admin = true;
