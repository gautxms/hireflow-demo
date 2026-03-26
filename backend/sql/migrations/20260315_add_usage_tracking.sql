CREATE TABLE IF NOT EXISTS usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  month_start DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_log_user_month
  ON usage_log (user_id, month_start);

CREATE INDEX IF NOT EXISTS idx_usage_log_ip_month
  ON usage_log (ip_address, month_start);

CREATE TABLE IF NOT EXISTS usage_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  upload_limit INTEGER,
  reset_usage BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_start)
);

COMMENT ON TABLE usage_overrides IS
  'Admin-managed overrides that can raise/lower monthly limits or reset usage for a user and month.';
