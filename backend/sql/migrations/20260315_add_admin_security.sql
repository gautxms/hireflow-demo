-- Admin security hardening: role gate, 2FA, audit trail, EULA and session metadata.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_two_factor_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS admin_two_factor_pending_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS admin_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS admin_pending_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS admin_eula_accepted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS admin_password_changed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS admin_last_login_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS admin_last_login_ip INET;

CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_created_at ON admin_actions (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type ON admin_actions (action_type);
