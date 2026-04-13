export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount BIGINT,
      currency TEXT,
      status TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('failed', 'retrying', 'succeeded', 'manual_required')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,
      last_error TEXT,
      payload JSONB,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check`)

  await pool.query(`
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('trialing', 'active', 'paused', 'cancelled'))
  `)

  await pool.query(`
    ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS transaction_id TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `)

  await pool.query(`
    ALTER TABLE payment_attempts
      ADD COLUMN IF NOT EXISTS transaction_id TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_subscription_id ON subscriptions(paddle_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_transaction_id ON payment_attempts(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON payment_attempts(user_id);
  `)
}
