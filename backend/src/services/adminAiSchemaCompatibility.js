import { pool } from '../db/client.js'

const ADMIN_AI_USER_COLUMNS = [
  { table: 'admin_system_prompts', column: 'updated_by' },
  { table: 'admin_ai_provider_keys', column: 'created_by' },
  { table: 'admin_ai_provider_keys', column: 'updated_by' },
  { table: 'admin_ai_settings', column: 'updated_by' },
]

export function normalizeTypeName(typeName) {
  const normalized = String(typeName || '').trim().toLowerCase()

  if (normalized === 'uuid') return 'uuid'
  if (normalized === 'integer' || normalized === 'int4') return 'integer'
  if (normalized === 'bigint' || normalized === 'int8') return 'bigint'

  if (
    normalized === 'text'
    || normalized === 'character varying'
    || normalized === 'varchar'
    || normalized === 'character'
    || normalized === 'bpchar'
  ) {
    return 'text'
  }

  throw new Error(`[Admin AI schema] Unsupported users.id type: ${typeName}`)
}

export function getCastExpression(columnName, targetType) {
  if (targetType === 'uuid') {
    return `CASE
      WHEN ${columnName} IS NULL THEN NULL
      WHEN ${columnName}::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN ${columnName}::uuid
      ELSE NULL
    END`
  }

  if (targetType === 'integer' || targetType === 'bigint') {
    return `CASE
      WHEN ${columnName} IS NULL THEN NULL
      WHEN ${columnName}::text ~ '^-?[0-9]+$' THEN ${columnName}::${targetType}
      ELSE NULL
    END`
  }

  if (targetType === 'text') {
    return `CASE
      WHEN ${columnName} IS NULL THEN NULL
      ELSE ${columnName}::text
    END`
  }

  throw new Error(`[Admin AI schema] Unsupported cast target: ${targetType}`)
}

export async function getUsersIdReferenceType(client) {
  const result = await client.query(`
    SELECT format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = 'users'
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1
  `)

  if (result.rows.length === 0) {
    throw new Error('[Admin AI schema] users.id column not found')
  }

  return normalizeTypeName(result.rows[0].data_type)
}

async function listUserColumnFks(client, tableName, columnName) {
  const result = await client.query(
    `SELECT tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = current_schema()
        AND tc.table_name = $1
        AND kcu.column_name = $2`,
    [tableName, columnName],
  )

  return result.rows.map((row) => row.constraint_name)
}

async function getColumnType(client, tableName, columnName) {
  const result = await client.query(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [tableName, columnName],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  const dataType = String(row.data_type || '').trim().toLowerCase()

  if (dataType === 'user-defined') {
    return normalizeTypeName(row.udt_name)
  }

  return normalizeTypeName(dataType)
}

function buildConstraintName(tableName, columnName) {
  return `fk_${tableName}_${columnName}_users_id`
}

export async function alignAdminAiUserReferenceColumns() {
  const client = await pool.connect()

  try {
    const usersIdType = await getUsersIdReferenceType(client)
    const alignedColumns = []

    for (const { table, column } of ADMIN_AI_USER_COLUMNS) {
      const currentType = await getColumnType(client, table, column)
      if (!currentType) continue

      const existingFks = await listUserColumnFks(client, table, column)
      for (const fkName of existingFks) {
        await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fkName}`)
      }

      if (currentType !== usersIdType) {
        const castExpr = getCastExpression(column, usersIdType)
        await client.query(`
          ALTER TABLE ${table}
          ALTER COLUMN ${column} TYPE ${usersIdType}
          USING (${castExpr})
        `)
      }

      const nextConstraintName = buildConstraintName(table, column)
      await client.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${nextConstraintName}
        FOREIGN KEY (${column}) REFERENCES users(id)
        ON DELETE SET NULL
      `)

      alignedColumns.push(`${table}.${column}`)
    }

    return { usersIdType, alignedColumns }
  } finally {
    client.release()
  }
}

export async function verifyAdminAiUserReferenceCompatibility() {
  const client = await pool.connect()

  try {
    const usersIdType = await getUsersIdReferenceType(client)
    const issues = []

    for (const { table, column } of ADMIN_AI_USER_COLUMNS) {
      const currentType = await getColumnType(client, table, column)
      if (!currentType) {
        issues.push(`${table}.${column} is missing`)
        continue
      }

      if (currentType !== usersIdType) {
        issues.push(`${table}.${column} type is ${currentType}, expected ${usersIdType}`)
      }

      const fkResult = await client.query(
        `SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = current_schema()
            AND tc.table_name = $1
            AND kcu.column_name = $2
            AND ccu.table_name = 'users'
            AND ccu.column_name = 'id'
          LIMIT 1`,
        [table, column],
      )

      if (fkResult.rows.length === 0) {
        issues.push(`${table}.${column} is missing a foreign key to users(id)`)
      }
    }

    return {
      ok: issues.length === 0,
      usersIdType,
      issues,
    }
  } finally {
    client.release()
  }
}
