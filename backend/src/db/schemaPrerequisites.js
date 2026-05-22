import { pool } from './client.js'

export async function verifyYearsExperienceDecimalSchema() {
  const result = await pool.query(
    `SELECT data_type, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'resumes'
       AND column_name = 'years_experience'
     LIMIT 1`,
  )

  const column = result.rows[0]
  if (!column) {
    return { ok: false, reason: 'missing_column' }
  }

  const dataType = String(column.data_type || '').toLowerCase()
  const numericPrecision = Number(column.numeric_precision)
  const numericScale = Number(column.numeric_scale)
  const isNumeric = dataType === 'numeric' || dataType === 'decimal'
  const hasExpectedShape = isNumeric && numericPrecision === 5 && numericScale === 2

  return {
    ok: hasExpectedShape,
    reason: hasExpectedShape ? null : 'invalid_column_type',
    actual: {
      dataType,
      numericPrecision: Number.isFinite(numericPrecision) ? numericPrecision : null,
      numericScale: Number.isFinite(numericScale) ? numericScale : null,
    },
    expected: {
      dataType: 'numeric',
      numericPrecision: 5,
      numericScale: 2,
    },
  }
}
