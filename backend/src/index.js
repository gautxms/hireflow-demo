import 'dotenv/config'
import rateLimit from 'express-rate-limit'
import app from './server.js'
import { runMigrations } from './db/migrate.js'

const port = process.env.PORT || 4000

const uploadIpRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many upload attempts',
    message: 'This IP has reached the daily upload request limit. Please try again tomorrow.',
  },
})

app.use('/api/uploads', uploadIpRateLimit)

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
