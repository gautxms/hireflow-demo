ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT CHECK (subscription_plan IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS subscription_renewal_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancellation_effective_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_brand TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_last4 TEXT;

CREATE TABLE IF NOT EXISTS subscription_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_plan TEXT,
  to_plan TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('upgrade', 'downgrade', 'cancel')),
  effective_at TIMESTAMP,
  prorated_credit_cents INTEGER DEFAULT 0,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paddle_transaction_id TEXT,
  invoice_number TEXT,
  billed_at TIMESTAMP NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'failed', 'refunded', 'pending')),
  invoice_pdf_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_change_events_user_created
  ON subscription_change_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_user_billed
  ON billing_invoices (user_id, billed_at DESC);
