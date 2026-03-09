ALTER TABLE users
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP;

ALTER TABLE users
  ALTER COLUMN subscription_status SET DEFAULT 'inactive';

UPDATE users
SET subscription_status = 'inactive'
WHERE subscription_status IS NULL;
