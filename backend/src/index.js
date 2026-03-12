import 'dotenv/config'
import app from './server.js'
import { runMigrations } from './db/migrate.js'

const port = process.env.PORT || 4000

async function start() {
  try {
    // Run database migrations first
    await runMigrations()
    
    // Then start the server
    app.listen(port, () => {
      console.log(`✓ Backend listening on port ${port}`)
    })
  } catch (error) {
    console.error('[Startup] Fatal error:', error)
    process.exit(1)
  }
}

start()
