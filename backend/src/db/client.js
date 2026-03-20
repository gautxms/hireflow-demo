import pkg from 'pg'

const { Pool } = pkg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})


export async function ensurePasswordResetTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id TEXT NOT NULL UNIQUE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      customer_email TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_payment_attempts_status_retry_at
      ON payment_attempts (status, next_retry_at);

    CREATE INDEX IF NOT EXISTS idx_payment_attempts_customer_email
      ON payment_attempts (customer_email);

  `)
}

export async function logErrorToDatabase(source, error, context = null) {
  const safeMessage = error?.message || String(error) || 'Unknown error'
  const errorType = error?.name || error?.code || 'UnknownError'
  const endpoint = context?.endpoint || context?.path || 'internal'
  const method = context?.method || 'SYSTEM'

  await pool.query(
    `INSERT INTO error_logs (
      error_type,
      source,
      endpoint,
      method,
      status_code,
      message,
      stack,
      request_context,
      error_fingerprint
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, md5($9))`,
    [
      errorType,
      source,
      endpoint,
      method,
      500,
      safeMessage,
      error?.stack || null,
      JSON.stringify(context || {}),
      `${errorType}:${endpoint}`,
    ],
  )
}
