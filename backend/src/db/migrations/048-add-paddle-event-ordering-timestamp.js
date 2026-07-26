export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_paddle_event_at TIMESTAMPTZ
  `)
}
