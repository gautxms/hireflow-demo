import { Router } from 'express'

const router = Router()

router.post('/checkout', (req, res) => {
  return res.status(410).json({
    error: 'Legacy checkout endpoint is deprecated. Use /api/paddle/checkout.',
  })
})

export default router
