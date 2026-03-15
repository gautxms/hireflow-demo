import 'dotenv/config'
import app from './server.js'
import passwordResetRoutes from './routes/passwordReset.js'
import { runMigrations } from './db/migrate.js'

const port = process.env.PORT || 4000

app.use('/api/password-reset', passwordResetRoutes)

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
