import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { generalApiLimiterAuth } from '../middleware/rateLimiter.js'

const router = Router()

const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_CLIENT_TOKEN = process.env.PADDLE_CLIENT_TOKEN
const PADDLE_ENVIRONMENT = process.env.PADDLE_ENVIRONMENT || 'production'

const PRICE_IDS_BY_PLAN = {
  monthly: process.env.PADDLE_MONTHLY_PRICE_ID,
  annual: process.env.PADDLE_ANNUAL_PRICE_ID,
}

function getAppOrigin(req) {
  return process.env.APP_ORIGIN || process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`
}

/**
 * POST /api/paddle/checkout
 * Create a Paddle transaction for embedded checkout
 */
router.post('/checkout', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  const { plan } = req.body || {}

  if (!process.env.PADDLE_API_KEY) {
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  if (!PADDLE_CLIENT_TOKEN) {
    return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN is not configured' })
  }

  const priceId = PRICE_IDS_BY_PLAN[plan]

  if (!priceId) {
    return res.status(500).json({ error: `Paddle price ID is missing for ${plan} plan` })
  }

  try {
    // Fetch user email from database
    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const appOrigin = getAppOrigin(req)
    const successUrl = `${appOrigin}/billing/success`
    const cancelUrl = `${appOrigin}/billing/cancel`

    // Call Paddle API to create transaction
    const paddleResponse = await fetch(`${PADDLE_API_BASE_URL}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
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
        return_url: successUrl,
      }),
    })

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      return res.status(502).json({ error: 'Failed to create Paddle transaction', details: paddlePayload })
    }

    const transactionId = paddlePayload?.data?.id
    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!transactionId) {
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response' })
    }

    if (!checkoutUrl) {
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response' })
    }

    // Return response with userEmail for Paddle.Initialize(pwCustomer)
    const resp1 = {
      checkoutUrl,
      userEmail: user.email,
      clientToken: PADDLE_CLIENT_TOKEN,
      paddleEnvironment: PADDLE_ENVIRONMENT,
      _version: 'WITH_USER_EMAIL_2026_03_26', // Marker to verify code is deployed
    }
    return res.json(resp1)
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
    })
  }
})

/**
 * POST /api/paddle/checkout-url
 * Legacy endpoint - returns same format as /checkout
 */
router.post('/checkout-url', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  const { plan } = req.body || {}

  if (!process.env.PADDLE_API_KEY) {
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  if (!PADDLE_CLIENT_TOKEN) {
    return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN is not configured' })
  }

  const priceId = PRICE_IDS_BY_PLAN[plan]

  if (!priceId) {
    return res.status(500).json({ error: `Paddle price ID is missing for ${plan} plan` })
  }

  try {
    // Fetch user email from database
    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const appOrigin = getAppOrigin(req)
    const successUrl = `${appOrigin}/billing/success`
    const cancelUrl = `${appOrigin}/billing/cancel`

    // Call Paddle API to create transaction
    const paddleResponse = await fetch(`${PADDLE_API_BASE_URL}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
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
        return_url: successUrl,
      }),
    })

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      return res.status(502).json({ error: 'Failed to create Paddle transaction', details: paddlePayload })
    }

    const transactionId = paddlePayload?.data?.id
    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!transactionId) {
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response' })
    }

    if (!checkoutUrl) {
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response' })
    }

    // Return response with userEmail for Paddle.Initialize(pwCustomer)
    const resp2 = {
      checkoutUrl,
      userEmail: user.email,
      clientToken: PADDLE_CLIENT_TOKEN,
      paddleEnvironment: PADDLE_ENVIRONMENT,
      _version: 'WITH_USER_EMAIL_2026_03_26', // Marker to verify code is deployed
    }
    return res.json(resp2)
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
    })
  }
})

export default router
// Deploy: Thu Mar 26 18:22:20 UTC 2026
