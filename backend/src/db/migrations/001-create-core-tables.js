export async function up(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified BOOLEAN DEFAULT false,
      email_verification_token TEXT,
      email_verification_expires_at TIMESTAMP,
      company TEXT,
      phone TEXT,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'inactive',
      subscription_started_at TIMESTAMP,
      trial_ends_at TIMESTAMP,
      deleted_at TIMESTAMP,
      deletion_scheduled_for TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resumes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      raw_text TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      paddle_subscription_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'cancelled')),
      latest_event_type TEXT,
      latest_event_payload JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS paddle_webhook_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      signature_valid BOOLEAN NOT NULL,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes (user_id);
    CREATE INDEX IF NOT EXISTS idx_resumes_created_at ON resumes (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON subscriptions (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paddle_webhook_audit_created_at ON paddle_webhook_audit (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
  `)
}
