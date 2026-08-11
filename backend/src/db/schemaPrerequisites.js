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

const REQUIRED_RESUME_QUOTA_COLUMNS = new Map([
  ['users', ['quota_anchor_at']],
  ['resume_quota_reservations', [
    'id',
    'user_id',
    'idempotency_key',
    'period_start',
    'period_end',
    'requested_units',
    'consumed_units',
    'released_units',
    'status',
    'expires_at',
  ]],
  ['resume_quota_allocations', [
    'id',
    'reservation_id',
    'user_id',
    'allocation_key',
    'upload_id',
    'resume_id',
    'parse_job_id',
    'status',
  ]],
  ['upload_chunks', ['quota_reservation_id', 'quota_allocation_id', 'quota_recorded', 'file_identity']],
  ['parse_jobs', ['quota_allocation_id']],
  ['usage_log', ['quota_allocation_id']],
])

const REQUIRED_RESUME_QUOTA_INDEXES = [
  'resume_quota_reservations_user_id_idempotency_key_key',
  'idx_resume_quota_reservations_availability',
  'resume_quota_allocations_user_id_allocation_key_key',
  'idx_resume_quota_allocations_reservation_status',
  'idx_resume_quota_allocations_upload',
  'idx_resume_quota_allocations_parse_job',
  'idx_usage_log_quota_allocation',
]

export async function verifyResumeQuotaReservationSchema(db = pool) {
  const tableNames = [...REQUIRED_RESUME_QUOTA_COLUMNS.keys()]
  const [columnResult, indexResult] = await Promise.all([
    db.query(
      `SELECT table_name::text, column_name::text
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [tableNames],
    ),
    db.query(
      `SELECT indexname::text
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])`,
      [REQUIRED_RESUME_QUOTA_INDEXES],
    ),
  ])

  const columns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`))
  const indexes = new Set(indexResult.rows.map((row) => row.indexname))
  const missingColumns = []
  for (const [tableName, requiredColumns] of REQUIRED_RESUME_QUOTA_COLUMNS) {
    for (const columnName of requiredColumns) {
      if (!columns.has(`${tableName}.${columnName}`)) {
        missingColumns.push(`${tableName}.${columnName}`)
      }
    }
  }
  const missingIndexes = REQUIRED_RESUME_QUOTA_INDEXES.filter((indexName) => !indexes.has(indexName))

  return {
    ok: missingColumns.length === 0 && missingIndexes.length === 0,
    missingColumns,
    missingIndexes,
  }
}
