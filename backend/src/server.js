import app from './app.js'
import adminRoutes from './routes/admin.js'
import adminSubscriptionsRoutes from './routes/admin/subscriptions.js'
import adminPaymentsRoutes from './routes/admin/payments.js'
import adminUploadsRoutes from './routes/admin/uploads.js'
import adminAnalyticsRoutes from './routes/admin/analytics.js'

app.use('/api/admin', adminRoutes)
app.use('/api/admin/subscriptions', adminSubscriptionsRoutes)
app.use('/api/admin/payments', adminPaymentsRoutes)
app.use('/api/admin/uploads', adminUploadsRoutes)
app.use('/api/admin/analytics', adminAnalyticsRoutes)

export default app
