import { pool } from './client.js'

export async function runMigrations() {
  console.log('[Migration] Starting database migrations...')

  const migrations = [
    {
      name: '001-add-paddle-fields',
      sql: `
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT,
        ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
      `,
    },
    {
      name: '002-ensure-subscription-status',
      sql: `
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'inactive';
      `,
    },
    {
      name: '003-add-subscription-started-at',
      sql: `
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP;
      `,
    },

    {
      name: '004-add-usage-tracking',
      sql: `
        CREATE TABLE IF NOT EXISTS usage_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ip_address TEXT NOT NULL,
          month_start DATE NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_usage_log_user_month
          ON usage_log (user_id, month_start);

        CREATE INDEX IF NOT EXISTS idx_usage_log_ip_month
          ON usage_log (ip_address, month_start);

        CREATE TABLE IF NOT EXISTS usage_overrides (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          month_start DATE NOT NULL,
          upload_limit INTEGER,
          reset_usage BOOLEAN NOT NULL DEFAULT false,
          note TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, month_start)
        );
      `,
    },
  ]

  for (const migration of migrations) {
    try {
      console.log(`[Migration] Running: ${migration.name}`)
      await pool.query(migration.sql)
      console.log(`[Migration] ✓ ${migration.name}`)
    } catch (error) {
      // Ignore column already exists errors
      if (error.message.includes('already exists')) {
        console.log(`[Migration] ℹ ${migration.name} (already exists)`)
      } else {
        console.error(`[Migration] ✗ ${migration.name}:`, error.message)
      }
    }
  }

  console.log('[Migration] ✓ All migrations completed')
}
