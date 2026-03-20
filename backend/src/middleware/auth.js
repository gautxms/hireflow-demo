import jwt from 'jsonwebtoken'
import { pool } from '../db/client.js'
import { requireActiveSubscription } from './subscriptionCheck.js'

export async function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.split(' ')[1]
  const token = bearerToken || req.cookies?.token

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    if (!decoded?.userId) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    if (decoded.user && decoded.user.id === decoded.userId) {
      req.userId = decoded.userId
      req.user = decoded.user
      return next()
    }

    const userResult = await pool.query(
      `SELECT id, email, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for
       FROM users WHERE id = $1`,
      [decoded.userId],
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    req.userId = user.id
    req.user = user
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export { requireActiveSubscription }
