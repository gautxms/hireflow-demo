import pkg from 'pg'

const { Pool } = pkg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function initializeDatabase() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`)
    
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
        created_at TIMESTAMP DEFAULT NOW()
      );
    `)

    // Add missing columns if they don't exist
    const missingColumns = [
      { name: 'email_verified', type: 'BOOLEAN DEFAULT false' },
      { name: 'email_verification_token', type: 'TEXT' },
      { name: 'email_verification_expires_at', type: 'TIMESTAMP' },
      { name: 'company', type: 'TEXT' },
      { name: 'phone', type: 'TEXT' },
      { name: 'paddle_customer_id', type: 'TEXT' },
      { name: 'paddle_subscription_id', type: 'TEXT' },
      { name: 'subscription_status', type: 'TEXT DEFAULT \'inactive\'' },
      { name: 'subscription_started_at', type: 'TIMESTAMP' },
      { name: 'trial_ends_at', type: 'TIMESTAMP' },
      { name: 'deleted_at', type: 'TIMESTAMP' },
      { name: 'deletion_scheduled_for', type: 'TIMESTAMP' },
    ]

    for (const column of missingColumns) {
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN ${column.name} ${column.type};`)
      } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
          console.error(`[Database] Column ${column.name} error:`, e.message)
        }
      }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS resumes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        raw_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_resumes_user_id
        ON resumes (user_id);
      CREATE INDEX IF NOT EXISTS idx_resumes_created_at
        ON resumes (created_at DESC);
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
      );
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
        ON subscriptions (user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at
        ON subscriptions (created_at DESC);
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS paddle_webhook_audit (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        signature_valid BOOLEAN NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_paddle_webhook_audit_created_at
        ON paddle_webhook_audit (created_at DESC);
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_created_at
        ON users (created_at DESC);
    `)
    
    console.log('[Database] ✓ Core tables initialized')
  } catch (error) {
    console.error('[Database] Initialization error:', error.message)
    // Don't fail startup if tables already exist
  }
}


export async function ensurePasswordResetTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT false,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_token ON password_reset_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON password_reset_tokens(user_id);
  `)
}

export async function ensurePaymentTrackingTables() {
  try {
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
      );
    `)
  } catch (e) {
    // Table might already exist, continue
  }

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_attempts_status_retry_at
        ON payment_attempts (status, next_retry_at);
    `)
  } catch (e) {
    // Index might already exist, continue
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        context JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `)
  } catch (e) {
    // Table might already exist, continue
  }
}

export async function logErrorToDatabase(source, error, context = null) {
  if (process.env.SENTRY_DSN && globalThis?.Sentry?.captureException) {
    globalThis.Sentry.captureException(error, {
      tags: { source },
      extra: context || {},
    })
    return
  }

  const safeMessage = error?.message || String(error) || 'Unknown error'

  await pool.query(
    `INSERT INTO error_logs (source, message, stack, context)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [source, safeMessage, error?.stack || null, JSON.stringify(context || {})],
  )
}
