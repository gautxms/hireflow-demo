import app from './app.js'
import adminRoutes from './routes/admin.js'
import adminSubscriptionsRoutes from './routes/admin/subscriptions.js'
import adminPaymentsRoutes from './routes/admin/payments.js'
import adminUploadsRoutes from './routes/admin/uploads.js'
import adminAnalyticsRoutes from './routes/admin/analytics.js'
import adminHealthRoutes from './routes/admin/health.js'
import adminLogsRoutes from './routes/admin/logs.js'
import { adminActionAuditMiddleware, requireAdminAuth } from './middleware/adminAuth.js'

app.use('/api/admin', requireAdminAuth, adminActionAuditMiddleware, adminRoutes)
app.use('/api/admin/subscriptions', requireAdminAuth, adminActionAuditMiddleware, adminSubscriptionsRoutes)
app.use('/api/admin/payments', requireAdminAuth, adminActionAuditMiddleware, adminPaymentsRoutes)
app.use('/api/admin/uploads', requireAdminAuth, adminActionAuditMiddleware, adminUploadsRoutes)
app.use('/api/admin/analytics', requireAdminAuth, adminActionAuditMiddleware, adminAnalyticsRoutes)
app.use('/api/admin/health', requireAdminAuth, adminActionAuditMiddleware, adminHealthRoutes)
app.use('/api/admin/logs', requireAdminAuth, adminActionAuditMiddleware, adminLogsRoutes)

export default app
