export async function up(pool) {
  await pool.query(`
    ALTER TABLE analyses
    ADD COLUMN IF NOT EXISTS name TEXT
  `)
}
