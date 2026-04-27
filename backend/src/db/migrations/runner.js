import { pool } from '../client.js'

const migrationFiles = [
  '001-create-core-tables',
  '002-add-password-reset-tokens',
  '003-add-usage-tracking',
  '004-add-events-and-analytics',
  '005-add-shortlists',
  '006-add-candidate-feedback',
  '007-add-candidate-tags',
  '008-add-job-descriptions',
  '009-add-upload-chunks',
  '010-add-parse-jobs',
  '011-fix-subscription-and-payment-schema',
  '012-add-admin-2fa-columns',
  '013-fix-admin-email-verification',
  '014-add-admin-ux-feedback',
  '015-add-resume-analysis-token-usage',
  '016-add-inquiries',
  '020-fix-admin-ai-user-reference-types',
  '017-add-admin-ai-provider-keys',
  '018-generalize-admin-ai-provider-config',
  '019-add-admin-system-prompt',
  '020-add-admin-ai-model-registry',
  '021-admin-ai-actor-columns-text-compat',
  '022-add-resume-ai-profile-fields',
  '023-add-job-description-metadata-columns',
  '024-add-parse-jobs-updated-at-indexes',
  '025-add-candidate-profiles',
  '026-add-analyses',
  '027-add-dashboard-kpi-indexes',
  '028-add-report-definitions',
]

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

export async function runMigrations() {
  console.log('[Migration] Starting database migrations...')

  const lockClient = await pool.connect()

  try {
    await ensureMigrationsTable(lockClient)

    await lockClient.query('SELECT pg_advisory_lock($1)', [293841])

    try {
      for (const name of migrationFiles) {
        const alreadyRun = await lockClient.query(
          'SELECT 1 FROM migrations WHERE name = $1 LIMIT 1',
          [name],
        )

        if (alreadyRun.rows.length > 0) {
          console.log(`[Migration] ↷ ${name} (already applied)`)
          continue
        }

        console.log(`[Migration] Running: ${name}`)
        const migration = await import(`./${name}.js`)

        try {
          await lockClient.query('BEGIN')
          await migration.up(lockClient)
          await lockClient.query('INSERT INTO migrations (name) VALUES ($1)', [name])
          await lockClient.query('COMMIT')
          console.log(`[Migration] ✓ ${name}`)
        } catch (error) {
          await lockClient.query('ROLLBACK')
          throw error
        }
      }
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [293841])
    }
  } finally {
    lockClient.release()
  }

  console.log('[Migration] ✓ All migrations completed')
}
