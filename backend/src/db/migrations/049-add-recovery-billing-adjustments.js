export async function up(client) {
  const typeResult = await client.query(`
    SELECT format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    WHERE a.attrelid = 'users'::regclass AND a.attname = 'id' AND NOT a.attisdropped
  `)
  const userIdType = typeResult.rows[0]?.data_type || 'integer'

  await client.query(`
    CREATE TABLE IF NOT EXISTS recovery_billing_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      paddle_environment TEXT NOT NULL CHECK (paddle_environment IN ('sandbox', 'production')),
      paddle_customer_id TEXT NOT NULL,
      paddle_subscription_id TEXT NOT NULL,
      recovery_transaction_id TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      previous_next_billed_at TIMESTAMPTZ NOT NULL,
      target_next_billed_at TIMESTAMPTZ NOT NULL,
      provider_confirmed_next_billed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'provider_updating', 'confirmed', 'already_satisfied',
        'retryable_failed', 'manual_required', 'superseded'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ,
      safe_error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ,
      UNIQUE (paddle_environment, recovery_transaction_id)
    )
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_recovery_billing_adjustments_due
      ON recovery_billing_adjustments (status, next_retry_at)
      WHERE status IN ('pending', 'retryable_failed')
  `)
}
