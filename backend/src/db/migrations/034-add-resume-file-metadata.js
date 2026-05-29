export async function up(pool) {
  await pool.query(`
    ALTER TABLE resumes
      ADD COLUMN IF NOT EXISTS original_filename TEXT,
      ADD COLUMN IF NOT EXISTS file_extension TEXT,
      ADD COLUMN IF NOT EXISTS original_mime_type TEXT
  `)
}
