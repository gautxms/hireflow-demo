export async function up(pool) {
  await pool.query(`
    ALTER TABLE resumes
      ALTER COLUMN years_experience TYPE NUMERIC(5,2)
      USING years_experience::NUMERIC(5,2);
  `)
}
