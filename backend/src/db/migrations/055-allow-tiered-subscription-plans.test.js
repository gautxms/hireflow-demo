import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { up } from './055-allow-tiered-subscription-plans.js'

test('tiered plan migration removes the legacy restriction without validating historical rows', async () => {
  const runner = await readFile(new URL('./runner.js', import.meta.url), 'utf8')
  assert.ok(runner.indexOf("'054-add-paddle-reconciliation-cadence'") < runner.indexOf("'055-allow-tiered-subscription-plans'"))

  const queries = []
  await up({
    async query(sql) {
      queries.push(sql)
      if (sql.includes('FROM pg_constraint')) return { rows: [{ name: 'users_subscription_plan_check' }] }
      return { rows: [] }
    },
  })

  assert.match(queries[0], /relation\.relname = 'users'/)
  assert.match(queries[0], /ILIKE '%subscription_plan%'/)
  assert.equal(queries[1], 'ALTER TABLE users DROP CONSTRAINT "users_subscription_plan_check"')
  assert.equal(queries.length, 2)
})

test('tiered plan migration completes when no legacy plan constraint exists', async () => {
  const queries = []
  await up({
    async query(sql) {
      queries.push(sql)
      return { rows: [] }
    },
  })

  assert.equal(queries.length, 1)
})
