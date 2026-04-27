import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import authRoutes from './routes/auth.js'
import adminSetupRoutes from './routes/adminSetup.js'
import adminPasswordResetRoutes from './routes/adminPasswordReset.js'
import adminMagicLinkRoutes from './routes/adminMagicLink.js'
import paddleWebhookRoutes from './routes/paddleWebhook.js'
import paddleCheckoutRoutes from './routes/paddleCheckout.js'
import paymentsRoutes from './routes/payments.js'
import uploadsRoutes from './routes/uploads.js'
import uploadChunksRoutes from './routes/uploadChunks.js'
import parseStatusRoutes from './routes/parseStatus.js'
import resultsRoutes from './routes/results.js'
import resultsExportRoutes from './routes/resultsExport.js'
import passwordResetRoutes from './routes/passwordReset.js'
import feedbackRoutes from './routes/feedback.js'
import profileRoutes from './routes/profile.js'
import subscriptionsRoutes from './routes/subscriptions.js'
import shortlistsRoutes from './routes/shortlists.js'
import candidatesRoutes from './routes/candidates.js'
import jobDescriptionsRoutes from './routes/jobDescriptions.js'
import inquiriesRoutes from './routes/inquiries.js'
import notificationsRoutes from './routes/notifications.js'
import analysesRoutes from './routes/analyses.js'
import adminRoutes from './routes/admin.js'
import adminSubscriptionsRoutes from './routes/admin/subscriptions.js'
import adminPaymentsRoutes from './routes/admin/payments.js'
import adminUploadsRoutes from './routes/admin/uploads.js'
import adminAnalyticsRoutes from './routes/admin/analytics.js'
import adminHealthRoutes from './routes/admin/health.js'
import adminLogsRoutes from './routes/admin/logs.js'
import adminUxRoutes from './routes/admin/ux.js'
import webhooksRoutes from './routes/webhooks.js'
import { requireAuth } from './middleware/authMiddleware.js'
import { requireActiveSubscription } from './middleware/subscriptionCheck.js'
import { adminActionAuditMiddleware, requireAdminAuth } from './middleware/adminAuth.js'
import { generalApiLimiterAuth, generalApiLimiterUnauth } from './middleware/rateLimiter.js'
import { AI_MODEL_CONFIG, isValidModelFormat } from './config/aiModels.js'

const app = express()

app.set('trust proxy', 1)

const vercelDomainSuffix = '.vercel.app'
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://hireflow.dev',
  'https://www.hireflow.dev',
  'https://api.hireflow.dev',
]

const envAllowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const allowedOrigins = new Set([...defaultAllowedOrigins, ...envAllowedOrigins])

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.has(origin) || origin.endsWith(vercelDomainSuffix)) {
      return callback(null, true)
    }

    console.warn('[CORS] Blocked origin:', origin)
    return callback(new Error('CORS not allowed'))
  },
}

app.use(cors(corsOptions))

// Keep Paddle webhook ahead of JSON parsing so route-level raw body handling still works.
app.use('/api/paddle/webhook', paddleWebhookRoutes)
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => {
  const aiModelWarnings = []
  const defaultModel = String(AI_MODEL_CONFIG.defaultModel || '').trim()

  if (!defaultModel || !isValidModelFormat(defaultModel)) {
    aiModelWarnings.push({
      type: 'invalid_default_model_format',
      source: 'env.ANTHROPIC_RESUME_MODEL',
      model: defaultModel || null,
      message: 'Configured default Anthropic model does not match expected provider model format.',
    })
  }

  res.json({ status: 'ok', warnings: aiModelWarnings })
})

app.use('/api', generalApiLimiterUnauth)

app.use('/api/auth', authRoutes)
app.use('/api/admin/setup', adminSetupRoutes)
app.use('/api/admin/reset-password-temporary', adminPasswordResetRoutes)
app.use('/api/admin/magic-link', adminMagicLinkRoutes)
app.use('/api/auth', passwordResetRoutes)
app.use('/api/paddle', paddleCheckoutRoutes)
app.use('/api/payments', requireAuth, generalApiLimiterAuth, paymentsRoutes)
app.use('/api/uploads', parseStatusRoutes)
app.use('/api/uploads/chunks', uploadChunksRoutes)
app.use('/api/uploads', uploadsRoutes)
app.use('/api/feedback', requireAuth, generalApiLimiterAuth, feedbackRoutes)
app.use('/api/results', resultsRoutes)
app.use('/api/resumes', resultsRoutes)
app.use('/api/results/export', resultsExportRoutes)
app.use('/api/profile', generalApiLimiterAuth, profileRoutes)
app.use('/api/subscriptions', generalApiLimiterAuth, subscriptionsRoutes)
app.use('/api/shortlists', generalApiLimiterAuth, shortlistsRoutes)
app.use('/api/candidates', generalApiLimiterAuth, candidatesRoutes)
app.use('/api/job-descriptions', requireAuth, generalApiLimiterAuth, requireActiveSubscription, jobDescriptionsRoutes)
app.use('/api/inquiries', inquiriesRoutes)
app.use('/api/notifications', requireAuth, generalApiLimiterAuth, notificationsRoutes)
app.use('/api/analyses', requireAuth, generalApiLimiterAuth, analysesRoutes)
app.use('/api/admin', requireAdminAuth, adminActionAuditMiddleware, adminRoutes)
app.use('/api/admin/subscriptions', requireAdminAuth, adminActionAuditMiddleware, adminSubscriptionsRoutes)
app.use('/api/admin/payments', requireAdminAuth, adminActionAuditMiddleware, adminPaymentsRoutes)
app.use('/api/admin/uploads', requireAdminAuth, adminActionAuditMiddleware, adminUploadsRoutes)
app.use('/api/admin/analytics', requireAdminAuth, adminActionAuditMiddleware, adminAnalyticsRoutes)
app.use('/api/admin/health', requireAdminAuth, adminActionAuditMiddleware, adminHealthRoutes)
app.use('/api/admin/logs', requireAdminAuth, adminActionAuditMiddleware, adminLogsRoutes)
app.use('/api/admin/ux', adminUxRoutes)
app.use('/api/admin/webhooks', requireAdminAuth, adminActionAuditMiddleware, webhooksRoutes)

app.get('/api/protected', requireAuth, generalApiLimiterAuth, (req, res) => {
  res.json({ userId: req.userId })
})

// Log all unmatched requests
app.use((req, res) => {
  console.log('[404] No route matched:', {
    method: req.method,
    path: req.path,
    url: req.url,
  })
  res.status(404).json({ error: 'Not found' })
})

export default app
