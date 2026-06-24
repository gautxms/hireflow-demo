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

test('migration runner includes follow-up users updated_at migration 037', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'037-add-users-updated-at'/)
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
  assert.doesNotMatch(usersSql, /updated_at TIMESTAMP DEFAULT NOW\(\)/)

  assert.match(subscriptionsSql, /ADD COLUMN IF NOT EXISTS paddle_environment TEXT/)

  const alteredTables = queries.flatMap((sql) => [...sql.matchAll(/ALTER TABLE\s+(\w+)/g)].map((match) => match[1]))
  assert.deepEqual(alteredTables, ['users', 'subscriptions'])
})

test('users updated_at follow-up migration is idempotent and scoped to users', async () => {
  const queries = []
  const { up } = await import('./037-add-users-updated-at.js')

  await up({
    query(sql) {
      queries.push(sql)
      return Promise.resolve({ rows: [] })
    },
  })

  assert.equal(queries.length, 1)

  const usersSql = queries[0]
  assert.match(usersSql, /ALTER TABLE users/)
  assert.equal((usersSql.match(/ALTER TABLE/g) || []).length, 1)
  assert.match(usersSql, /ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW\(\)/)
})
