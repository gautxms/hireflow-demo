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
      name: '004-add-password-reset-tokens',
      sql: `
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
      `,
    },
    {
      name: '005-add-usage-tracking',
      sql: `
        CREATE TABLE IF NOT EXISTS usage_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    {
      name: '006-add-events-and-analytics',
      sql: `
        CREATE TABLE IF NOT EXISTS events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_events_event_type_timestamp
          ON events (event_type, timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_events_user_timestamp
          ON events (user_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS analytics_daily (
          metric_date DATE PRIMARY KEY,
          dau INTEGER NOT NULL DEFAULT 0,
          wau INTEGER NOT NULL DEFAULT 0,
          mau INTEGER NOT NULL DEFAULT 0,
          conversion_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
          churn_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
          arpu NUMERIC(12,2) NOT NULL DEFAULT 0,
          parsing_success_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
          mrr NUMERIC(12,2) NOT NULL DEFAULT 0,
          arr NUMERIC(12,2) NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS analytics_revenue_by_plan (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          metric_month DATE NOT NULL,
          plan_type TEXT NOT NULL,
          revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
          paying_users INTEGER NOT NULL DEFAULT 0,
          arpu NUMERIC(12,2) NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(metric_month, plan_type)
        );

        CREATE INDEX IF NOT EXISTS idx_analytics_revenue_by_plan_month
          ON analytics_revenue_by_plan (metric_month DESC);
      `,
    },

    {
      name: '007-add-candidate-feedback',
      sql: `
        CREATE TABLE IF NOT EXISTS candidate_feedback (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          candidate_id TEXT NOT NULL,
          feedback_type TEXT NOT NULL CHECK (feedback_type IN ('helpful', 'unhelpful', 'flag_false_positive', 'flag_missing')),
          comment TEXT,
          sentiment_label TEXT NOT NULL DEFAULT 'neutral',
          sentiment_score INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          feedback_date DATE GENERATED ALWAYS AS (created_at::date) STORED
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_feedback_daily_unique
          ON candidate_feedback (user_id, candidate_id, feedback_date);

        CREATE INDEX IF NOT EXISTS idx_candidate_feedback_created_at
          ON candidate_feedback (created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_candidate_feedback_type_created_at
          ON candidate_feedback (feedback_type, created_at DESC);
      `,
    },

  ]

  for (const migration of migrations) {
    try {
      console.log(`[Migration] Running: ${migration.name}`)
      await pool.query(migration.sql)
      console.log(`[Migration] ✓ ${migration.name}`)
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`[Migration] ℹ ${migration.name} (already exists)`)
      } else {
        console.error(`[Migration] ✗ ${migration.name}:`, error.message)
      }
    }
  }

  console.log('[Migration] ✓ All migrations completed')
}
