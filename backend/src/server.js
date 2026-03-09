import app from './app.js'
import adminRoutes from './routes/admin.js'

app.use('/api/admin', adminRoutes)

export default app
