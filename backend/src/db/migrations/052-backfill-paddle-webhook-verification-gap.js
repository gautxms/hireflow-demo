export async function up(client) {
  // Migration 051 could finish before an older rolling-deployment replica
  // persisted its final already-verified event. Re-run the safe payload-backed
  // backfill so those rows become eligible for scheduled recovery immediately.
  await client.query(`
    UPDATE paddle_webhook_events
    SET verified_at = COALESCE(verified_at, first_received_at, created_at)
    WHERE payload IS NOT NULL
      AND verified_at IS NULL
  `)
}
