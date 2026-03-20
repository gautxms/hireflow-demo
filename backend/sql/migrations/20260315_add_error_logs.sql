CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_type TEXT NOT NULL,
  source TEXT NOT NULL,
  endpoint TEXT,
  method TEXT,
  status_code INTEGER NOT NULL DEFAULT 500,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  stack TEXT,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  sentry_event_id TEXT,
  error_fingerprint TEXT NOT NULL,
  alert_sent BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
  ON error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_type_endpoint
  ON error_logs (error_type, endpoint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_fingerprint
  ON error_logs (error_fingerprint, created_at DESC);
