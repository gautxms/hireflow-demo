function normalizeTypeName(typeName) {
  const normalized = String(typeName || '').trim().toLowerCase()

  if (normalized === 'uuid') return 'uuid'
  if (normalized === 'integer' || normalized === 'int4') return 'integer'
  if (normalized === 'bigint' || normalized === 'int8') return 'bigint'

  throw new Error(`[Migration 020] Unsupported users.id type: ${typeName}`)
}

function getCastExpression(columnName, targetType) {
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

  throw new Error(`[Migration 020] Unsupported cast target: ${targetType}`)
}

async function getUsersIdType(client) {
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
    throw new Error('[Migration 020] users.id column not found')
  }

  return normalizeTypeName(result.rows[0].data_type)
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
  return normalizeTypeName(row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type)
}

async function listForeignKeys(client, tableName, columnName) {
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

export async function up(client) {
  const usersIdType = await getUsersIdType(client)
  const columns = [
    { table: 'admin_system_prompts', column: 'updated_by' },
    { table: 'admin_ai_provider_keys', column: 'created_by' },
    { table: 'admin_ai_provider_keys', column: 'updated_by' },
    { table: 'admin_ai_settings', column: 'updated_by' },
  ]

  for (const { table, column } of columns) {
    const currentType = await getColumnType(client, table, column)
    if (!currentType) continue

    const fkConstraints = await listForeignKeys(client, table, column)
    for (const fkName of fkConstraints) {
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fkName}`)
    }

    if (currentType !== usersIdType) {
      await client.query(`
        ALTER TABLE ${table}
        ALTER COLUMN ${column} TYPE ${usersIdType}
        USING (${getCastExpression(column, usersIdType)})
      `)
    }

    await client.query(`
      ALTER TABLE ${table}
      ADD CONSTRAINT fk_${table}_${column}_users_id
      FOREIGN KEY (${column}) REFERENCES users(id)
      ON DELETE SET NULL
    `)
  }
}
