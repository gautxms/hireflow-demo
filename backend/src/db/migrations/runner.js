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
]

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

export async function runMigrations() {
  console.log('[Migration] Starting database migrations...')

  await ensureMigrationsTable()

  await pool.query('SELECT pg_advisory_lock($1)', [293841])

  try {
    for (const name of migrationFiles) {
      const alreadyRun = await pool.query(
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
        await pool.query('BEGIN')
        await migration.up(pool)
        await pool.query('INSERT INTO migrations (name) VALUES ($1)', [name])
        await pool.query('COMMIT')
        console.log(`[Migration] ✓ ${name}`)
      } catch (error) {
        await pool.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [293841])
  }

  console.log('[Migration] ✓ All migrations completed')
}
