import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'

const router = Router()

const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_API_VERSION = process.env.PADDLE_API_VERSION || '1'

const PRICE_IDS_BY_PLAN = {
  monthly: process.env.PADDLE_MONTHLY_PRICE_ID,
  annual: process.env.PADDLE_ANNUAL_PRICE_ID,
}

function getAppOrigin(req) {
  return process.env.APP_ORIGIN || process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`
}

router.post('/checkout-url', requireAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  const { plan } = req.body || {}

  console.log('[Paddle Checkout] Request received:', {
    plan,
    userId: req.userId,
    timestamp: new Date().toISOString(),
    apiKeyExists: !!process.env.PADDLE_API_KEY,
    priceIds: {
      monthly: process.env.PADDLE_MONTHLY_PRICE_ID || 'MISSING',
      annual: process.env.PADDLE_ANNUAL_PRICE_ID || 'MISSING',
    },
  })

  if (!process.env.PADDLE_API_KEY) {
    console.error('[Paddle Checkout] PADDLE_API_KEY not configured')
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  const priceId = PRICE_IDS_BY_PLAN[plan]

  if (!priceId) {
    console.error('[Paddle Checkout] Missing price ID for plan:', {
      plan,
      monthlyId: PRICE_IDS_BY_PLAN.monthly || 'NOT SET',
      annualId: PRICE_IDS_BY_PLAN.annual || 'NOT SET',
    })
    return res.status(500).json({ error: `Paddle price ID is missing for ${plan} plan` })
  }

  try {
    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const appOrigin = getAppOrigin(req)
    const successUrl = `${appOrigin}/billing/success`
    const cancelUrl = `${appOrigin}/billing/cancel`

    console.log('[Paddle Checkout] Calling Paddle API:', {
      endpoint: `${PADDLE_API_BASE_URL}/transactions`,
      priceId,
      userEmail: user.email,
    })

    const paddleResponse = await fetch(`${PADDLE_API_BASE_URL}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
        'Paddle-Version': PADDLE_API_VERSION,
      },
      body: JSON.stringify({
        items: [{
          price_id: priceId,
          quantity: 1,
        }],
        customer: {
          email: user.email,
        },
        custom_data: {
          userId: user.id,
          email: user.email,
          plan,
        },
        checkout: {
          url: successUrl,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      }),
    })

    console.log('[Paddle Checkout] Paddle API response status:', paddleResponse.status)

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      console.error('[Paddle checkout] failed to create transaction:', {
        status: paddleResponse.status,
        payload: paddlePayload,
      })
      return res.status(502).json({ error: 'Failed to create Paddle checkout URL', details: paddlePayload })
    }

    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!checkoutUrl) {
      console.error('[Paddle checkout] missing checkout URL in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response', payload: paddlePayload })
    }

    console.log('[Paddle Checkout] Success, returning URL')
    return res.json({ checkoutUrl })
  } catch (error) {
    console.error('[Paddle Checkout] Error:', {
      message: error.message,
      code: error.code || 'UNKNOWN',
      status: error.status || 'UNKNOWN',
      stack: error.stack,
    })

    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
      code: error.code,
    })
  }
})

export default router
