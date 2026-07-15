export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS trial_consumed_at TIMESTAMP
  `)

  await client.query(`
    UPDATE users user_account
    SET trial_consumed_at = COALESCE(
      user_account.subscription_started_at,
      user_account.trial_ends_at,
      user_account.created_at,
      NOW()
    )
    WHERE user_account.trial_consumed_at IS NULL
      AND (
        user_account.subscription_started_at IS NOT NULL
        OR user_account.trial_ends_at IS NOT NULL
        OR user_account.paddle_subscription_id IS NOT NULL
        OR LOWER(COALESCE(user_account.subscription_status, 'inactive')) NOT IN ('inactive', 'no_subscription', 'none', 'free', '')
        OR EXISTS (
          SELECT 1
          FROM subscriptions subscription
          WHERE subscription.user_id = user_account.id
        )
        OR EXISTS (
          SELECT 1
          FROM payment_attempts attempt
          WHERE attempt.user_id = user_account.id
        )
      )
  `)
}
