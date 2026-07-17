export async function up(client) {
  await client.query(`
    DO $$
    DECLARE
      constraint_record RECORD;
    BEGIN
      FOR constraint_record IN
        SELECT namespace.nspname AS schema_name,
               relation.relname AS table_name,
               constraint_definition.conname AS constraint_name
        FROM pg_constraint constraint_definition
        JOIN pg_class relation ON relation.oid = constraint_definition.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND relation.relname = 'subscription_change_events'
          AND constraint_definition.contype = 'c'
          AND pg_get_constraintdef(constraint_definition.oid) ILIKE '%change_type%'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.%I DROP CONSTRAINT %I',
          constraint_record.schema_name,
          constraint_record.table_name,
          constraint_record.constraint_name
        );
      END LOOP;
    END $$;

    ALTER TABLE subscription_change_events
      ADD CONSTRAINT subscription_change_events_change_type_check
      CHECK (change_type IN ('upgrade', 'downgrade', 'cancel', 'keep_subscription'));
  `)
}
