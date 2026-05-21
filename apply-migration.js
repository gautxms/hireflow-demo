import pg from 'pg'
import fs from 'fs'

const connectionString = 'postgresql://postgres:FFvwamgqANbyuCaNYXFaItoJgrxTBSmA@postgres.railway.internal:5432/railway'
const migrationSql = fs.readFileSync('./backend/src/db/migrations/20260413_add_admin_2fa_columns.sql', 'utf8')

const pool = new pg.Pool({ connectionString })

async function runMigration() {
  const client = await pool.connect()
  try {
    console.log('[Migration] Executing 2FA columns migration...')
    await client.query(migrationSql)
    console.log('[Migration] ✅ Successfully added admin 2FA columns')
    
    // Verify columns exist
    const result = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='users' AND column_name LIKE 'admin_%'
      ORDER BY column_name
    `)
    console.log('[Migration] Verified columns:', result.rows.map(r => r.column_name).join(', '))
  } catch (error) {
    console.error('[Migration] ❌ Error:', error.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

runMigration()
