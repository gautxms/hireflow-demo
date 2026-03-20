CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_email TEXT,
  amount BIGINT,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('pending', 'failed', 'retry_scheduled', 'retrying', 'succeeded', 'manual_required')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMP,
  last_attempted_at TIMESTAMP,
  error_code TEXT,
  last_error TEXT,
  payload JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_status_retry_at
  ON payment_attempts (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_customer_email
  ON payment_attempts (customer_email);

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS error_code TEXT;

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  context JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
