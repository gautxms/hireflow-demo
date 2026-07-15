export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ALTER COLUMN paddle_environment SET DEFAULT 'production'
  `)

  await client.query(`
    UPDATE users
    SET paddle_environment = 'production'
    WHERE paddle_environment IS NULL
       OR LOWER(paddle_environment) NOT IN ('production', 'sandbox')
  `)

  await client.query(`
    ALTER TABLE subscriptions
      ALTER COLUMN paddle_environment SET DEFAULT 'production'
  `)

  await client.query(`
    UPDATE subscriptions subscription
    SET paddle_environment = COALESCE(user_account.paddle_environment, 'production')
    FROM users user_account
    WHERE subscription.user_id = user_account.id
      AND subscription.paddle_environment IS NULL
  `)

  await client.query(`
    UPDATE subscriptions
    SET paddle_environment = 'production'
    WHERE paddle_environment IS NULL
       OR LOWER(paddle_environment) NOT IN ('production', 'sandbox')
  `)

  await client.query(`
    ALTER TABLE payment_attempts
      ADD COLUMN IF NOT EXISTS paddle_environment TEXT
  `)

  await client.query(`
    UPDATE payment_attempts
    SET paddle_environment = CASE
      WHEN LOWER(COALESCE(payload->'data'->'custom_data'->>'paddleEnvironment', payload->'custom_data'->>'paddleEnvironment', '')) = 'sandbox'
        THEN 'sandbox'
      ELSE 'production'
    END
    WHERE paddle_environment IS NULL
       OR LOWER(paddle_environment) NOT IN ('production', 'sandbox')
  `)

  await client.query(`
    ALTER TABLE payment_attempts
      ALTER COLUMN paddle_environment SET DEFAULT 'production'
  `)
}
