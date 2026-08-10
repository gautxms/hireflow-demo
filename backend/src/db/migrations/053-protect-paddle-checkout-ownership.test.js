import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPaddleOwnership, up } from './053-protect-paddle-checkout-ownership.js'

function cleanAuditRows() {
  return {
    customer_rows: 2,
    subscription_rows: 1,
    null_customer_ids: 1,
    null_subscription_ids: 2,
    empty_customer_ids: 0,
    empty_subscription_ids: 0,
    malformed_customer_ids: 0,
    malformed_subscription_ids: 0,
    invalid_environments: 0,
  }
}

test('migration 053 audits ownership before adding checkout and provider uniqueness', async () => {
  const queries = []
  const client = {
    async query(sql) {
      const text = String(sql)
      queries.push(text)
      if (/format_type\(a\.atttypid/.test(text)) return { rowCount: 1, rows: [{ data_type: 'bigint' }] }
      if (/COUNT\(\*\) FILTER/.test(text)) return { rowCount: 1, rows: [cleanAuditRows()] }
      if (/SELECT id, paddle_environment[\s\S]*NOT IN \('production', 'sandbox'\)/.test(text)) return { rowCount: 0, rows: [] }
      return { rowCount: 0, rows: [] }
    },
  }

  await up(client)

  const sql = queries.join('\n')
  assert.ok(queries.findIndex((query) => /COUNT\(\*\) FILTER/.test(query)) < queries.findIndex((query) => /CREATE TABLE IF NOT EXISTS paddle_checkout_reservations/.test(query)))
  assert.match(sql, /user_id bigint NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(sql, /status IN \('creating', 'ready'\)/)
  assert.match(sql, /idx_paddle_checkout_transaction_environment_unique/)
  assert.match(sql, /idx_users_paddle_customer_environment_unique/)
  assert.match(sql, /idx_users_paddle_subscription_environment_unique/)
  assert.match(sql, /DROP CONSTRAINT IF EXISTS subscriptions_paddle_subscription_id_key/)
  assert.match(sql, /DROP INDEX IF EXISTS idx_subscriptions_paddle_subscription_id_unique/)
  assert.match(sql, /idx_subscriptions_paddle_environment_subscription_unique/)
  assert.match(sql, /ON subscriptions \(paddle_environment, paddle_subscription_id\)/)
  assert.match(sql, /COALESCE\(NULLIF\(LOWER\(BTRIM\(paddle_environment\)\), ''\), 'production'\)/)
  assert.match(sql, /UPDATE users[\s\S]*SET paddle_environment = LOWER\(COALESCE\(NULLIF\(BTRIM\(paddle_environment\), ''\), 'production'\)\)/)
  assert.match(sql, /UPDATE subscriptions[\s\S]*SET paddle_environment = LOWER\(COALESCE\(NULLIF\(BTRIM\(paddle_environment\), ''\), 'production'\)\)/)
})

test('migration 053 stops before DDL when existing customer ownership conflicts', async () => {
  const queries = []
  const client = {
    async query(sql) {
      const text = String(sql)
      queries.push(text)
      if (/format_type\(a\.atttypid/.test(text)) return { rowCount: 1, rows: [{ data_type: 'integer' }] }
      if (/COUNT\(\*\) FILTER/.test(text)) return { rowCount: 1, rows: [cleanAuditRows()] }
      if (/SELECT id, paddle_environment[\s\S]*NOT IN \('production', 'sandbox'\)/.test(text)) return { rowCount: 0, rows: [] }
      if (/GROUP BY 1, 2[\s\S]*HAVING COUNT\(\*\) > 1/.test(text) && /paddle_customer_id/.test(text)) {
        return { rowCount: 1, rows: [{ environment: 'sandbox', provider_id: 'ctm_sensitive_identifier', user_ids: [12, 34] }] }
      }
      return { rowCount: 0, rows: [] }
    },
  }

  await assert.rejects(
    up(client),
    (error) => {
      assert.match(error.message, /controlled remediation/)
      assert.match(error.message, /ctm_\.\.\./)
      assert.doesNotMatch(error.message, /ctm_sensitive_identifier/)
      assert.match(error.message, /12,34/)
      return true
    },
  )
  assert.equal(queries.some((query) => /CREATE TABLE IF NOT EXISTS paddle_checkout_reservations/.test(query)), false)
})

test('ownership audit reports invalid environments and projection mismatches without personal data', async () => {
  let call = 0
  const audit = await auditPaddleOwnership({
    async query() {
      call += 1
      if (call === 1) return { rowCount: 1, rows: [{ ...cleanAuditRows(), invalid_environments: 1 }] }
      if (call === 2) return { rowCount: 0, rows: [] }
      if (call === 3) return { rowCount: 0, rows: [] }
      if (call === 4) return {
        rowCount: 1,
        rows: [{
          provider_id: 'sub_sensitive_identifier',
          projection_user_id: 40,
          users_owner_id: 41,
          projection_environment: 'sandbox',
          users_environment: 'production',
        }],
      }
      if (call === 5) return { rowCount: 1, rows: [{ id: 77, paddle_environment: 'staging' }] }
      return { rowCount: 1, rows: [{ id: 'projection-88', user_id: 78, paddle_environment: 'preview' }] }
    },
  })

  assert.equal(audit.invalid_environments, 1)
  assert.equal(audit.conflicting_projection_owners, 1)
  assert.deepEqual(audit.conflicts[0], {
    type: 'projection_owner_mismatch',
    providerId: 'sub_...tifier',
    projectionUserId: 40,
    usersOwnerId: 41,
    projectionEnvironment: 'sandbox',
    usersEnvironment: 'production',
  })
  assert.deepEqual(audit.conflicts[1], {
    type: 'invalid_environment',
    userId: 77,
    environment: 'staging',
  })
  assert.deepEqual(audit.conflicts[2], {
    type: 'invalid_projection_environment',
    projectionId: 'projection-88',
    userId: 78,
    environment: 'preview',
  })
})
