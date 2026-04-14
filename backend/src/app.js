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
import { requireAuth } from './middleware/authMiddleware.js'
import { requireActiveSubscription } from './middleware/subscriptionCheck.js'
import { generalApiLimiterAuth, generalApiLimiterUnauth } from './middleware/rateLimiter.js'

const app = express()

app.set('trust proxy', 1)

const vercelDomainSuffix = '.vercel.app'
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'https://hireflow.dev',
  'https://www.hireflow.dev',
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
  res.json({ status: 'ok' })
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
