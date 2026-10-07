export async function up(client) {
  const constraints = await client.query(`
    SELECT constraint_definition.conname AS name
    FROM pg_constraint constraint_definition
    JOIN pg_class relation ON relation.oid = constraint_definition.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'users'
      AND constraint_definition.contype = 'c'
      AND pg_get_constraintdef(constraint_definition.oid) ILIKE '%subscription_plan%'
  `)

  for (const { name } of constraints.rows) {
    const quotedName = `"${String(name).replaceAll('"', '""')}"`
    await client.query(`ALTER TABLE users DROP CONSTRAINT ${quotedName}`)
  }
  // Historic rows can contain plan values outside the current catalog. A new
  // CHECK would validate every existing row and prevent the app from starting.
  // Checkout and provider reconciliation validate plan codes before writing.
}
