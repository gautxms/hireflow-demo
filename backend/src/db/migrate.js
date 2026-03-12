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
