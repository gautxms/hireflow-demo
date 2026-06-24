export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS paddle_environment TEXT,
      ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `)

  await client.query(`
    ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS paddle_environment TEXT
  `)
}
