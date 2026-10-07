// Keep this list fixed so the migration remains reproducible if the catalog changes.
const SUPPORTED_PLANS = [
  'monthly', 'annual',
  'starter_monthly', 'starter_annual',
  'growth_monthly', 'growth_annual',
  'pro_monthly', 'pro_annual',
]

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

  await client.query(`
    ALTER TABLE users
      ADD CONSTRAINT users_subscription_plan_check
      CHECK (subscription_plan IS NULL OR subscription_plan IN (${SUPPORTED_PLANS.map((plan) => `'${plan}'`).join(', ')}))
  `)
}
