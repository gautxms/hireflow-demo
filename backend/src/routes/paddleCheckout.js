import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { generalApiLimiterAuth } from '../middleware/rateLimiter.js'

const router = Router()

const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_API_VERSION = process.env.PADDLE_API_VERSION || '1'
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
 * 
 * Request body: { plan: 'monthly' | 'annual' }
 * Response: { transactionId, clientToken, paddleEnvironment }
 */
router.post('/checkout', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  const { plan } = req.body || {}

  console.log('[Paddle Embedded Checkout] Request received:', {
    plan,
    userId: req.userId,
    timestamp: new Date().toISOString(),
    apiKeyExists: !!process.env.PADDLE_API_KEY,
    clientTokenExists: !!PADDLE_CLIENT_TOKEN,
    priceIds: {
      monthly: PRICE_IDS_BY_PLAN.monthly || 'MISSING',
      annual: PRICE_IDS_BY_PLAN.annual || 'MISSING',
    },
  })

  if (!process.env.PADDLE_API_KEY) {
    console.error('[Paddle Checkout] PADDLE_API_KEY not configured')
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  if (!PADDLE_CLIENT_TOKEN) {
    console.error('[Paddle Checkout] PADDLE_CLIENT_TOKEN not configured')
    return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN is not configured' })
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

    console.log('[Paddle Embedded Checkout] Creating transaction:', {
      endpoint: `${PADDLE_API_BASE_URL}/transactions`,
      priceId,
      userEmail: user.email,
      successUrl,
      cancelUrl,
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
        // Return URLs for after embedded checkout completes
        return_url: successUrl,
      }),
    })

    console.log('[Paddle Embedded Checkout] Paddle API response status:', paddleResponse.status)

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      console.error('[Paddle Embedded Checkout] Failed to create transaction:', {
        status: paddleResponse.status,
        payload: paddlePayload,
      })
      return res.status(502).json({ error: 'Failed to create Paddle transaction', details: paddlePayload })
    }

    const transactionId = paddlePayload?.data?.id

    if (!transactionId) {
      console.error('[Paddle Embedded Checkout] Missing transaction ID in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response', payload: paddlePayload })
    }

    console.log('[Paddle Embedded Checkout] Success, returning transaction ID:', transactionId)
    
    // Return transaction ID and client token for frontend to open embedded checkout
    return res.json({
      transactionId,
      clientToken: PADDLE_CLIENT_TOKEN,
      paddleEnvironment: PADDLE_ENVIRONMENT,
    })
  } catch (error) {
    console.error('[Paddle Embedded Checkout] Error:', {
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

/**
 * POST /api/paddle/checkout-url
 * Legacy endpoint - now returns embedded checkout format for backwards compatibility
 */
router.post('/checkout-url', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  const { plan } = req.body || {}

  console.log('[Paddle Checkout URL] Request received:', {
    plan,
    userId: req.userId,
    timestamp: new Date().toISOString(),
    apiKeyExists: !!process.env.PADDLE_API_KEY,
    clientTokenExists: !!PADDLE_CLIENT_TOKEN,
  })

  if (!process.env.PADDLE_API_KEY) {
    console.error('[Paddle Checkout URL] PADDLE_API_KEY not configured')
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  if (!PADDLE_CLIENT_TOKEN) {
    console.error('[Paddle Checkout URL] PADDLE_CLIENT_TOKEN not configured')
    return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN is not configured' })
  }

  const priceId = PRICE_IDS_BY_PLAN[plan]

  if (!priceId) {
    console.error('[Paddle Checkout URL] Missing price ID for plan:', {
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

    console.log('[Paddle Checkout URL] Creating transaction:', {
      endpoint: `${PADDLE_API_BASE_URL}/transactions`,
      priceId,
      userEmail: user.email,
      successUrl,
      cancelUrl,
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
        return_url: successUrl,
      }),
    })

    console.log('[Paddle Checkout URL] Paddle API response status:', paddleResponse.status)

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      console.error('[Paddle Checkout URL] Failed to create transaction:', {
        status: paddleResponse.status,
        payload: paddlePayload,
      })
      return res.status(502).json({ error: 'Failed to create Paddle transaction', details: paddlePayload })
    }

    const transactionId = paddlePayload?.data?.id

    if (!transactionId) {
      console.error('[Paddle Checkout URL] Missing transaction ID in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response', payload: paddlePayload })
    }

    console.log('[Paddle Checkout URL] Success, returning embedded checkout data:', transactionId)
    
    // Return in embedded checkout format (same as /checkout endpoint)
    return res.json({
      transactionId,
      clientToken: PADDLE_CLIENT_TOKEN,
      paddleEnvironment: PADDLE_ENVIRONMENT,
      // Also include checkoutUrl for fallback
      checkoutUrl: `${appOrigin}/checkout?plan=${plan}`,
    })
  } catch (error) {
    console.error('[Paddle Checkout URL] Error:', {
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
