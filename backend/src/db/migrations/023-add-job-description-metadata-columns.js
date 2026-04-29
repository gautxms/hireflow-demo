export async function up(pool) {
  await pool.query(`
    ALTER TABLE job_descriptions
      ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'unspecified',
      ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS archived_reason TEXT,
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1
  `)
}
