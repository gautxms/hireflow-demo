import { Router } from 'express'
import { pool } from '../db/client.js'
import { getFailedPaymentsForAdmin } from '../services/paymentRetry.js'

const router = Router()

router.get('/users', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, subscription_status, paddle_subscription_id, created_at
       FROM users
       ORDER BY created_at DESC`,
    )

    return res.json(result.rows)
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/failed-payments', async (_req, res) => {
  try {
    const rows = await getFailedPaymentsForAdmin()
    return res.json(rows)
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
