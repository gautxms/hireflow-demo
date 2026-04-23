export async function up(pool) {
  await pool.query(`
    ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS years_experience INTEGER,
    ADD COLUMN IF NOT EXISTS profile_score INTEGER,
    ADD COLUMN IF NOT EXISTS strengths JSONB,
    ADD COLUMN IF NOT EXISTS considerations JSONB,
    ADD COLUMN IF NOT EXISTS seniority_level TEXT,
    ADD COLUMN IF NOT EXISTS tags JSONB,
    ADD COLUMN IF NOT EXISTS top_skills JSONB,
    ADD COLUMN IF NOT EXISTS skills_structured JSONB,
    ADD COLUMN IF NOT EXISTS skills JSONB;
  `)
}
