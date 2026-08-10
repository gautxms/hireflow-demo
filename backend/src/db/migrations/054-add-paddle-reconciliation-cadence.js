export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_paddle_reconciliation_attempt_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_paddle_reconciled_at TIMESTAMPTZ
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_users_paddle_reconciliation_candidates
      ON users (
        last_paddle_reconciliation_attempt_at ASC NULLS FIRST,
        id
      )
      WHERE NULLIF(BTRIM(paddle_subscription_id), '') IS NOT NULL
        AND NULLIF(BTRIM(paddle_customer_id), '') IS NOT NULL
        AND deleted_at IS NULL
  `)
}
