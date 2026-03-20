import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import authRoutes from './routes/auth.js'
import paddleWebhookRoutes from './routes/paddleWebhook.js'
import paddleCheckoutRoutes from './routes/paddleCheckout.js'
import paymentsRoutes from './routes/payments.js'
import uploadsRoutes from './routes/uploads.js'
import passwordResetRoutes from './routes/passwordReset.js'
import subscriptionsRoutes from './routes/subscriptions.js'
import emailCampaignRoutes from './routes/emailCampaigns.js'
import { requireAuth } from './middleware/authMiddleware.js'
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
    // Allow server-to-server or local non-browser requests with no Origin header.
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
app.use('/api/auth', passwordResetRoutes)
app.use('/api/paddle', paddleCheckoutRoutes)
app.use('/api/payments', requireAuth, generalApiLimiterAuth, paymentsRoutes)
app.use('/api/uploads', requireAuth, generalApiLimiterAuth, uploadsRoutes)
app.use('/api/subscriptions', requireAuth, generalApiLimiterAuth, subscriptionsRoutes)
app.use('/api/email-campaigns', emailCampaignRoutes)

app.get('/api/protected', requireAuth, generalApiLimiterAuth, (req, res) => {
  res.json({ userId: req.userId })
})

// Log all requests that don't match a route (for debugging 404 issues)
app.use((req, res) => {
  console.log('[404] No route matched:', {
    method: req.method,
    path: req.path,
    url: req.url,
    headers: {
      'content-type': req.headers['content-type'],
      'authorization': req.headers.authorization ? 'present' : 'missing',
    },
  })
  res.status(404).json({ error: 'Not found' })
})

export default app
