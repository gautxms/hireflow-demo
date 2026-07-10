import test from 'node:test'
import assert from 'node:assert/strict'
import { up } from './041-align-payment-attempts-schema.js'
import { recordFailedPaymentAttempt } from '../../services/paymentRetry.js'
import { pool } from '../client.js'

test('041 aligns legacy payment_attempts data before creating partial transaction arbiter', async () => {
  const queries = []
  const fakePool = {
    async query(sql) {
      queries.push(String(sql))
      return { rowCount: 0, rows: [] }
    },
  }

  await up(fakePool)

  const migrationSql = queries.join('\n')
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS transaction_id TEXT/)
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS customer_email TEXT/)
  assert.match(migrationSql, /SET transaction_id = paddle_transaction_id/)
  assert.match(migrationSql, /target\.transaction_id IS NOT NULL/)
  assert.match(migrationSql, /target\.ctid <> \(/)
  assert.match(migrationSql, /CREATE UNIQUE INDEX idx_payment_attempts_transaction_id_unique\s+ON payment_attempts \(transaction_id\)\s+WHERE transaction_id IS NOT NULL/)
  assert.equal(/ALTER TABLE payment_attempts[\s\S]+DROP COLUMN\s+paddle_transaction_id/i.test(migrationSql), false)
})

test('041 partial index predicate matches recordFailedPaymentAttempt upsert arbiter', async (t) => {
  const migrationQueries = []
  await up({
    async query(sql) {
      migrationQueries.push(String(sql))
      return { rowCount: 0, rows: [] }
    },
  })

  const paymentAttemptQueries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    paymentAttemptQueries.push(String(sql))
    return { rows: [{ transaction_id: params[0], status: 'failed' }] }
  })

  await recordFailedPaymentAttempt({
    event_type: 'transaction.payment_failed',
    data: { id: 'txn_after_alignment', customer: { email: 'customer@example.com' } },
  })

  const migrationSql = migrationQueries.join('\n')
  const upsertSql = paymentAttemptQueries.join('\n')
  assert.match(migrationSql, /WHERE transaction_id IS NOT NULL/)
  assert.match(upsertSql, /ON CONFLICT \(transaction_id\) WHERE transaction_id IS NOT NULL/)
})
