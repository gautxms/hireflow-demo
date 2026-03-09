import { Router } from 'express'
import { pool } from '../db/client.js'

const router = Router()

router.get('/users', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not found' })
  }

  try {
    const result = await pool.query(
      `SELECT id, email, subscription_status, paddle_subscription_id, created_at
       FROM users
       ORDER BY created_at DESC`,
    )

    return res.json({ users: result.rows })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
