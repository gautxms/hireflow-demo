export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS quota_anchor_at TIMESTAMP
  `)

  await client.query(`
    UPDATE users
    SET quota_anchor_at = current_period_end
    WHERE quota_anchor_at IS NULL
      AND LOWER(COALESCE(subscription_status, '')) = 'active'
      AND current_period_end IS NOT NULL
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_usage_log_user_created_at
      ON usage_log (user_id, created_at)
  `)
}
