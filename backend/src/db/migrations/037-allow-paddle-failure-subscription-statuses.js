export async function up(pool) {
  await pool.query(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check`)

  await pool.query(`
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('past_due', 'payment_failed', 'paused', 'cancelled', 'trialing', 'active'))
  `)
}
