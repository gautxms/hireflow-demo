import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function readRunnerSource() {
  return readFile(new URL('./runner.js', import.meta.url), 'utf8')
}

test('migration runner includes years_experience decimal migration 031', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'031-make-years-experience-decimal'/)
})

test('migration runner includes AI score cache migration 035', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'035-add-ai-score-cache'/)
})

test('migration runner includes Paddle user subscription column safety migration 036', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'036-ensure-paddle-user-subscription-columns'/)
})

test('migration runner includes Paddle failure status migration 037 after migration 036', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'037-allow-paddle-failure-subscription-statuses'/)
  assert.ok(
    source.indexOf("'035-add-ai-score-cache'") < source.indexOf("'036-ensure-paddle-user-subscription-columns'"),
  )
  assert.ok(
    source.indexOf("'036-ensure-paddle-user-subscription-columns'") < source.indexOf("'037-allow-paddle-failure-subscription-statuses'"),
  )
})

test('migration runner includes subscription tracking safety migration 038 after migration 037', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'038-ensure-subscription-tracking-columns'/)
  assert.ok(
    source.indexOf("'037-allow-paddle-failure-subscription-statuses'") <
      source.indexOf("'038-ensure-subscription-tracking-columns'"),
  )
})


test('migration runner includes subscriptions current read safety migration 039 after migration 038', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'039-ensure-subscriptions-current-read-schema'/)
  assert.ok(
    source.indexOf("'038-ensure-subscription-tracking-columns'") <
      source.indexOf("'039-ensure-subscriptions-current-read-schema'"),
  )
})

test('Paddle user subscription column safety migration is idempotent and scoped to Paddle tables', async () => {
  const queries = []
  const { up } = await import('./036-ensure-paddle-user-subscription-columns.js')

  await up({
    query(sql) {
      queries.push(sql)
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 2)

  const usersSql = queries[0]
  assert.match(usersSql, /ALTER TABLE users/)
  assert.equal((usersSql.match(/ALTER TABLE/g) || []).length, 1)

  for (const column of [
    'subscription_plan TEXT',
    'current_period_end TIMESTAMP',
    'next_billing_date TIMESTAMP',
    'paddle_environment TEXT',
    'subscription_started_at TIMESTAMP',
    'paddle_customer_id TEXT',
    'paddle_subscription_id TEXT',
    'trial_ends_at TIMESTAMP',
  ]) {
    assert.match(usersSql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`))
  }

  const subscriptionsSql = queries[1]
  assert.match(subscriptionsSql, /ALTER TABLE subscriptions/)
  assert.equal((subscriptionsSql.match(/ALTER TABLE/g) || []).length, 1)
  assert.match(subscriptionsSql, /ADD COLUMN IF NOT EXISTS paddle_environment TEXT/)

  const alteredTables = queries.flatMap((sql) => [...sql.matchAll(/ALTER TABLE\s+(\w+)/g)].map((match) => match[1]))
  assert.deepEqual(alteredTables, ['users', 'subscriptions'])
})

test('Paddle failure status migration safely replaces subscriptions status constraint', async () => {
  const queries = []
  const { up } = await import('./037-allow-paddle-failure-subscription-statuses.js')

  await up({
    query(sql) {
      queries.push(sql)
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 2)
  assert.match(queries[0], /ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check/)
  assert.match(queries[1], /ALTER TABLE subscriptions/)
  assert.match(queries[1], /ADD CONSTRAINT subscriptions_status_check/)

  for (const status of ['active', 'trialing', 'cancelled', 'paused', 'past_due', 'payment_failed']) {
    assert.match(queries[1], new RegExp(`'${status}'`))
  }
})

test('subscription tracking safety migration is additive and uses users.id type for user references', async () => {
  const queries = []
  const { up } = await import('./038-ensure-subscription-tracking-columns.js')

  await up({
    query(sql) {
      queries.push(sql)
      if (/format_type\(a\.atttypid, a\.atttypmod\)/.test(sql)) {
        return Promise.resolve({ rows: [{ data_type: 'uuid' }] })
      }
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 6)
  assert.match(queries[0], /SELECT format_type\(a\.atttypid, a\.atttypmod\) AS data_type/)

  const usersSql = queries[1]
  assert.match(usersSql, /ALTER TABLE users/)

  for (const column of [
    'subscription_plan TEXT',
    'subscription_renewal_date TIMESTAMP',
    'next_billing_date TIMESTAMP',
    'cancellation_effective_at TIMESTAMP',
    'cancellation_reason TEXT',
    'payment_method_brand TEXT',
    'payment_method_last4 TEXT',
    'current_period_end TIMESTAMP',
    'subscription_started_at TIMESTAMP',
    'paddle_customer_id TEXT',
    'paddle_subscription_id TEXT',
    'trial_ends_at TIMESTAMP',
    'paddle_environment TEXT',
  ]) {
    assert.match(usersSql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`))
  }

  assert.match(queries[2], /CREATE TABLE IF NOT EXISTS subscription_change_events/)
  assert.match(queries[2], /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(queries[3], /CREATE TABLE IF NOT EXISTS billing_invoices/)
  assert.match(queries[3], /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(queries[4], /CREATE INDEX IF NOT EXISTS idx_subscription_change_events_user_created/)
  assert.match(queries[5], /CREATE INDEX IF NOT EXISTS idx_billing_invoices_user_billed/)
})


test('subscriptions current read safety migration is additive and uses users.id type', async () => {
  const queries = []
  const { up } = await import('./039-ensure-subscriptions-current-read-schema.js')

  await up({
    query(sql) {
      queries.push(sql)
      if (/format_type\(a\.atttypid, a\.atttypmod\)/.test(sql)) {
        return Promise.resolve({ rows: [{ data_type: 'bigint' }] })
      }
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 6)
  assert.match(queries[0], /SELECT format_type\(a\.atttypid, a\.atttypmod\) AS data_type/)
  assert.match(queries[1], /CREATE EXTENSION IF NOT EXISTS pgcrypto/)
  assert.match(queries[2], /CREATE TABLE IF NOT EXISTS subscriptions/)
  assert.match(queries[2], /user_id bigint REFERENCES users\(id\) ON DELETE SET NULL/)
  assert.match(queries[2], /paddle_subscription_id TEXT UNIQUE/)
  assert.match(queries[2], /status TEXT NOT NULL DEFAULT 'inactive'/)
  assert.match(queries[2], /paddle_environment TEXT/)
  assert.match(queries[2], /created_at TIMESTAMP DEFAULT NOW\(\)/)
  assert.match(queries[3], /ALTER TABLE subscriptions/)

  for (const column of [
    'user_id bigint REFERENCES users\\(id\\) ON DELETE SET NULL',
    'paddle_subscription_id TEXT',
    "status TEXT NOT NULL DEFAULT 'inactive'",
    'latest_event_type TEXT',
    'latest_event_payload JSONB',
    'paddle_environment TEXT',
    'created_at TIMESTAMP DEFAULT NOW\\(\\)',
    'updated_at TIMESTAMP DEFAULT NOW\\(\\)',
  ]) {
    assert.match(queries[3], new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`))
  }

  assert.match(queries[4], /CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_paddle_subscription_id_unique/)
  assert.match(queries[4], /ON subscriptions \(paddle_subscription_id\)/)
  assert.match(queries[5], /CREATE INDEX IF NOT EXISTS idx_subscriptions_user_created/)
  assert.match(queries[5], /ON subscriptions \(user_id, created_at DESC\)/)
})

test('migration runner includes shortlist batch-add safety migration 040 after migration 039', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'040-ensure-shortlist-batch-add-schema'/)
  assert.ok(
    source.indexOf("'039-ensure-subscriptions-current-read-schema'") <
      source.indexOf("'040-ensure-shortlist-batch-add-schema'"),
  )
})

test('migration runner includes Paddle environment isolation migration 042 after payment-attempt alignment', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'042-isolate-paddle-environments'/)
  assert.ok(
    source.indexOf("'041-align-payment-attempts-schema'") <
      source.indexOf("'042-isolate-paddle-environments'"),
  )
})

test('Paddle environment isolation migration defaults existing billing records safely', async () => {
  const queries = []
  const { up } = await import('./042-isolate-paddle-environments.js')

  await up({
    query(sql) {
      queries.push(String(sql))
      return Promise.resolve({ rows: [] })
    },
  })

  const sql = queries.join('\n')
  assert.match(sql, /ALTER TABLE users[\s\S]*ALTER COLUMN paddle_environment SET DEFAULT 'production'/)
  assert.match(sql, /UPDATE users[\s\S]*LOWER\(paddle_environment\) NOT IN \('production', 'sandbox'\)/)
  assert.match(sql, /UPDATE subscriptions subscription[\s\S]*FROM users user_account/)
  assert.match(sql, /ALTER TABLE payment_attempts[\s\S]*ADD COLUMN IF NOT EXISTS paddle_environment TEXT/)
  assert.match(sql, /payload->'data'->'custom_data'->>'paddleEnvironment'/)
  assert.match(sql, /ALTER TABLE payment_attempts[\s\S]*ALTER COLUMN paddle_environment SET DEFAULT 'production'/)
})

test('migration runner adds immutable trial-consumption tracking after Paddle environment isolation', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'043-add-trial-consumption'/)
  assert.ok(
    source.indexOf("'042-isolate-paddle-environments'") <
      source.indexOf("'043-add-trial-consumption'"),
  )
})

test('trial-consumption migration backfills every account with subscription history', async () => {
  const queries = []
  const { up } = await import('./043-add-trial-consumption.js')

  await up({
    query(sql) {
      queries.push(String(sql))
      return Promise.resolve({ rows: [] })
    },
  })

  const sql = queries.join('\n')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS trial_consumed_at TIMESTAMP/)
  assert.match(sql, /subscription_started_at IS NOT NULL/)
  assert.match(sql, /trial_ends_at IS NOT NULL/)
  assert.match(sql, /paddle_subscription_id IS NOT NULL/)
  assert.match(sql, /subscription_status[\s\S]*NOT IN \('inactive', 'no_subscription', 'none', 'free', ''\)/)
  assert.match(sql, /EXISTS \([\s\S]*FROM subscriptions subscription[\s\S]*subscription\.user_id = user_account\.id/)
  assert.match(sql, /FROM payment_attempts attempt[\s\S]*attempt\.user_id = user_account\.id/)
})

test('migration runner allows keep-subscription audit events after trial tracking', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'044-allow-keep-subscription-change-events'/)
  assert.ok(
    source.indexOf("'043-add-trial-consumption'") <
      source.indexOf("'044-allow-keep-subscription-change-events'"),
  )
})

test('keep-subscription audit migration safely replaces the change type constraint', async () => {
  const queries = []
  const { up } = await import('./044-allow-keep-subscription-change-events.js')

  await up({
    query(sql) {
      queries.push(String(sql))
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 1)
  assert.match(queries[0], /pg_get_constraintdef[\s\S]*ILIKE '%change_type%'/)
  assert.match(queries[0], /DROP CONSTRAINT %I/)
  assert.match(queries[0], /ADD CONSTRAINT subscription_change_events_change_type_check/)
  for (const changeType of ['upgrade', 'downgrade', 'cancel', 'keep_subscription']) {
    assert.match(queries[0], new RegExp(`'${changeType}'`))
  }
})

test('migration runner adds the resume quota anchor after subscription lifecycle migrations', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'045-add-resume-quota-anchor'/)
  assert.ok(
    source.indexOf("'044-allow-keep-subscription-change-events'") <
      source.indexOf("'045-add-resume-quota-anchor'"),
  )
})

test('resume quota anchor migration is additive and only backfills known active billing boundaries', async () => {
  const queries = []
  const { up } = await import('./045-add-resume-quota-anchor.js')

  await up({
    query(sql) {
      queries.push(String(sql))
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 3)
  assert.match(queries[0], /ALTER TABLE users/)
  assert.match(queries[0], /ADD COLUMN IF NOT EXISTS quota_anchor_at TIMESTAMP/)
  assert.match(queries[1], /SET quota_anchor_at = current_period_end/)
  assert.match(queries[1], /quota_anchor_at IS NULL/)
  assert.match(queries[1], /subscription_status/)
  assert.match(queries[1], /current_period_end IS NOT NULL/)
  assert.match(queries[2], /CREATE INDEX IF NOT EXISTS idx_usage_log_user_created_at/)
  assert.match(queries[2], /ON usage_log \(user_id, created_at\)/)
})

test('shortlist batch-add safety migration is additive and preserves metadata columns', async () => {
  const queries = []
  const { up } = await import('./040-ensure-shortlist-batch-add-schema.js')

  await up({
    query(sql) {
      queries.push(sql)
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 4)
  assert.match(queries[0], /ALTER TABLE shortlist_candidates/)
  for (const column of [
    'analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL',
    'candidate_snapshot JSONB',
    'decision_status TEXT',
    'created_at TIMESTAMP DEFAULT NOW()',
    'updated_at TIMESTAMP DEFAULT NOW()',
    'source_context JSONB',
  ]) {
    assert.ok(queries[0].includes(`ADD COLUMN IF NOT EXISTS ${column}`))
  }
  assert.match(queries[1], /UPDATE shortlist_candidates/)
  assert.match(queries[2], /ALTER COLUMN created_at SET NOT NULL/)
  assert.match(queries[2], /ALTER COLUMN updated_at SET NOT NULL/)
  assert.match(queries[3], /CREATE INDEX IF NOT EXISTS idx_shortlist_candidates_analysis_id/)
})
