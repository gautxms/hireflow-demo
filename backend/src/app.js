import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/user.js'
import { requireAuth } from './middleware/authMiddleware.js'

const app = express()

app.set('trust proxy', 1)

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)

app.get('/api/protected', requireAuth, (req, res) => {
  res.json({ userId: req.userId })
})

export default app
