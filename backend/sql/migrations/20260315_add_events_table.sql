CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_event_type_timestamp ON events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_timestamp ON events (user_id, timestamp DESC);

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

CREATE INDEX IF NOT EXISTS idx_analytics_revenue_by_plan_month ON analytics_revenue_by_plan (metric_month DESC);
