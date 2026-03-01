import { Router } from 'express'

const router = Router()

router.post('/checkout', (req, res) => {
  const { plan, priceId } = req.body || {}

  if (plan !== 'monthly' && plan !== 'annual') {
    return res.status(400).json({ error: 'Plan must be monthly or annual' })
  }

  if (!priceId) {
    return res.status(400).json({ error: 'priceId is required' })
  }

  console.log('[CHECKOUT] Plan:', plan)
  console.log('[CHECKOUT] Price ID:', priceId)

  return res.json({ status: 'ok' })
})

export default router
