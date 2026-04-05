import app from './app.js'
import adminRoutes from './routes/admin.js'
import adminSubscriptionsRoutes from './routes/admin/subscriptions.js'
import adminPaymentsRoutes from './routes/admin/payments.js'

app.use('/api/admin', adminRoutes)
app.use('/api/admin/subscriptions', adminSubscriptionsRoutes)
app.use('/api/admin/payments', adminPaymentsRoutes)

export default app
