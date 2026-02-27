import jwt from 'jsonwebtoken'
import { pool } from '../db/client.js'

export function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.split(' ')[1]
  const token = bearerToken || req.cookies?.token

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.userId
    req.userRole = decoded.role || 'user'
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export async function requireAdmin(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.userRole === 'admin') {
    return next()
  }

  try {
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId])
    const user = result.rows[0]

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    req.userRole = 'admin'
    return next()
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
}
