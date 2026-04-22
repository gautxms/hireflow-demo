const ACTOR_COLUMNS = [
  { table: 'admin_ai_provider_keys', column: 'created_by' },
  { table: 'admin_ai_provider_keys', column: 'updated_by' },
  { table: 'admin_ai_settings', column: 'updated_by' },
  { table: 'admin_system_prompts', column: 'updated_by' },
]

async function hasColumn(pool, table, column) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [table, column],
  )
  return result.rows.length > 0
}

export async function up(pool) {
  for (const { table, column } of ACTOR_COLUMNS) {
    const exists = await hasColumn(pool, table, column)
    if (!exists) continue

    await pool.query(`
      DO $$
      DECLARE fk RECORD;
      BEGIN
        FOR fk IN
          SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
          JOIN unnest(con.conkey) AS conkey(attnum) ON true
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = conkey.attnum
          WHERE con.contype = 'f'
            AND nsp.nspname = 'public'
            AND rel.relname = '${table}'
            AND att.attname = '${column}'
        LOOP
          EXECUTE format('ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS %I', fk.conname);
        END LOOP;
      END $$;
    `)

    await pool.query(
      `ALTER TABLE ${table}
       ALTER COLUMN ${column} TYPE TEXT
       USING (${column}::text)`,
    )
  }
}
