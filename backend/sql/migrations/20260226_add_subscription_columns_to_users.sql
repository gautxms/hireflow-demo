-- Add optional Stripe subscription metadata to users.
-- Backward compatible: all new columns are nullable.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_status TEXT,
  ADD COLUMN IF NOT EXISTS trial_end TIMESTAMP;
