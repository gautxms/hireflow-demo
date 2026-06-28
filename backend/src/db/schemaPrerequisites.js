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


export async function verifyShortlistBatchAddSchema(db = pool) {
  const requiredColumns = new Map([
    ['analysis_id', 'uuid'],
    ['candidate_snapshot', 'jsonb'],
    ['source_context', 'jsonb'],
    ['created_at', 'timestamp without time zone'],
    ['updated_at', 'timestamp without time zone'],
  ])

  const result = await db.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'shortlist_candidates'
       AND column_name = ANY($1::text[])`,
    [[...requiredColumns.keys()]],
  )

  const columns = new Map(result.rows.map((row) => [row.column_name, row]))
  const issues = []
  for (const [columnName, expectedType] of requiredColumns) {
    const column = columns.get(columnName)
    if (!column) {
      issues.push({ column: columnName, reason: 'missing_column', expectedType })
      continue
    }
    const actualType = column.udt_name === 'uuid' ? 'uuid' : String(column.data_type || '').toLowerCase()
    if (actualType !== expectedType) {
      issues.push({ column: columnName, reason: 'invalid_column_type', expectedType, actualType })
    }
  }

  return { ok: issues.length === 0, issues }
}
