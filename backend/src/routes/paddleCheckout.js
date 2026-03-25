import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { generalApiLimiterAuth } from '../middleware/rateLimiter.js'

const router = Router()

const PADDLE_API_BASE_URL = process.env.PADDLE_API_BASE_URL || 'https://api.paddle.com'
const PADDLE_CLIENT_TOKEN = process.env.PADDLE_CLIENT_TOKEN
const PADDLE_ENVIRONMENT = process.env.PADDLE_ENVIRONMENT || 'production'

// Debug: Log environment on startup (masked for security)
console.log('[Paddle Config] Loaded on startup:', {
  hasPaddleApiKey: !!process.env.PADDLE_API_KEY,
  paddleApiKeyPrefix: process.env.PADDLE_API_KEY?.substring(0, 10) || 'NOT SET',
  hasPaddleClientToken: !!PADDLE_CLIENT_TOKEN,
  paddleClientTokenPrefix: PADDLE_CLIENT_TOKEN?.substring(0, 10) || 'NOT SET',
  paddleEnvironment: PADDLE_ENVIRONMENT,
})

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

  console.log('[CHECKOUT] REQUEST RECEIVED - Full details:', {
    endpoint: '/api/paddle/checkout',
    plan,
    userId: req.userId,
    timestamp: new Date().toISOString(),
    apiKeyExists: !!process.env.PADDLE_API_KEY,
    clientTokenExists: !!PADDLE_CLIENT_TOKEN,
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
    console.log('[CHECKOUT] Fetching user from database for userId:', req.userId)
    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId])
    const user = userResult.rows[0]

    console.log('[CHECKOUT] User fetch result:', {
      userFound: !!user,
      userId: user?.id,
      userEmail: user?.email || 'NO EMAIL',
      userEmailType: typeof user?.email,
    })

    if (!user) {
      console.error('[CHECKOUT] ERROR: User not found')
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
    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!transactionId) {
      console.error('[Paddle Embedded Checkout] Missing transaction ID in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response', payload: paddlePayload })
    }

    if (!checkoutUrl) {
      console.error('[Paddle Embedded Checkout] Missing checkout URL in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response', payload: paddlePayload })
    }

    // Build response with all required fields
    const responseData = {
      checkoutUrl,
      userEmail: user.email,
      clientToken: PADDLE_CLIENT_TOKEN,
      paddleEnvironment: PADDLE_ENVIRONMENT,
    }
    
    console.log('[CHECKOUT] ✓ SUCCESS - SENDING RESPONSE:', {
      hasCheckoutUrl: !!responseData.checkoutUrl,
      hasUserEmail: !!responseData.userEmail,
      userEmailValue: responseData.userEmail,
      hasClientToken: !!responseData.clientToken,
      hasPaddleEnvironment: !!responseData.paddleEnvironment,
      fullResponseKeys: Object.keys(responseData),
    })
    
    return res.json(responseData)
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

  console.log('[CHECKOUT-URL] REQUEST RECEIVED - Full details:', {
    endpoint: '/api/paddle/checkout-url',
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
    console.log('[CHECKOUT-URL] Fetching user from database for userId:', req.userId)
    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId])
    const user = userResult.rows[0]

    console.log('[CHECKOUT-URL] User fetch result:', {
      userFound: !!user,
      userId: user?.id,
      userEmail: user?.email || 'NO EMAIL',
      userEmailType: typeof user?.email,
    })

    if (!user) {
      console.error('[CHECKOUT-URL] ERROR: User not found')
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
    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!transactionId) {
      console.error('[Paddle Checkout URL] Missing transaction ID in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response', payload: paddlePayload })
    }

    if (!checkoutUrl) {
      console.error('[Paddle Checkout URL] Missing checkout URL in response:', paddlePayload)
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response', payload: paddlePayload })
    }

    // Build response with all required fields
    const responseData = {
      checkoutUrl,
      userEmail: user.email,
      clientToken: PADDLE_CLIENT_TOKEN,
      paddleEnvironment: PADDLE_ENVIRONMENT,
    }
    
    console.log('[CHECKOUT-URL] ✓ SUCCESS - SENDING RESPONSE:', {
      hasCheckoutUrl: !!responseData.checkoutUrl,
      hasUserEmail: !!responseData.userEmail,
      userEmailValue: responseData.userEmail,
      hasClientToken: !!responseData.clientToken,
      hasPaddleEnvironment: !!responseData.paddleEnvironment,
      fullResponseKeys: Object.keys(responseData),
    })
    
    return res.json(responseData)
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
