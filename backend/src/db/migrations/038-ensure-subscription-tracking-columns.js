export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
      ADD COLUMN IF NOT EXISTS subscription_renewal_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancellation_effective_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
      ADD COLUMN IF NOT EXISTS payment_method_brand TEXT,
      ADD COLUMN IF NOT EXISTS payment_method_last4 TEXT,
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP,
      ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS paddle_environment TEXT
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS subscription_change_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_plan TEXT,
      to_plan TEXT,
      change_type TEXT NOT NULL CHECK (change_type IN ('upgrade', 'downgrade', 'cancel')),
      effective_at TIMESTAMP,
      prorated_credit_cents INTEGER DEFAULT 0,
      reason TEXT,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      paddle_transaction_id TEXT,
      invoice_number TEXT,
      billed_at TIMESTAMP NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'failed', 'refunded', 'pending')),
      invoice_pdf_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_subscription_change_events_user_created
      ON subscription_change_events (user_id, created_at DESC)
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_billing_invoices_user_billed
      ON billing_invoices (user_id, billed_at DESC)
  `)
}
