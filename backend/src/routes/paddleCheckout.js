import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { generalApiLimiterAuth } from '../middleware/rateLimiter.js'
import { resolvePaddleConfig } from '../config/paddle.js'

const router = Router()
const TEST_MONTHLY_PLAN = 'test-monthly'
const TEST_MONTHLY_STORED_PLAN = 'monthly'

function getAppOrigin(req) {
  return process.env.APP_ORIGIN || process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`
}

export function validatePaddleCheckoutPlan({ plan, testKey, paddle }) {
  if (plan !== TEST_MONTHLY_PLAN) {
    return { ok: true, priceId: paddle.priceIdsByPlan[plan], storedPlan: plan }
  }

  if (!paddle.testCheckout?.enabled || !paddle.priceIdsByPlan[TEST_MONTHLY_PLAN]) {
    return { ok: false, status: 404, error: 'Checkout is unavailable' }
  }

  if (!paddle.testCheckout.key || testKey !== paddle.testCheckout.key) {
    return { ok: false, status: 403, error: 'Checkout is unavailable' }
  }

  return { ok: true, priceId: paddle.priceIdsByPlan[TEST_MONTHLY_PLAN], storedPlan: TEST_MONTHLY_STORED_PLAN }
}

async function createCheckout(req, res, logLabel) {
  const { plan, testKey } = req.body || {}

  const paddle = resolvePaddleConfig()
  console.info(`[Paddle ${logLabel}] resolved configuration`, {
    environment: paddle.environment,
    apiBaseUrl: paddle.apiBaseUrl,
    hasApiKey: Boolean(paddle.apiKey),
    hasClientToken: Boolean(paddle.clientToken),
    hasMonthlyPriceId: Boolean(paddle.priceIdsByPlan.monthly),
    hasAnnualPriceId: Boolean(paddle.priceIdsByPlan.annual),
    testCheckoutEnabled: Boolean(paddle.testCheckout?.enabled),
  })

  if (!paddle.apiKey) {
    return res.status(500).json({ error: 'PADDLE_API_KEY is not configured' })
  }

  if (!paddle.clientToken) {
    return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN is not configured' })
  }

  const planAccess = validatePaddleCheckoutPlan({ plan, testKey, paddle })

  if (!planAccess.ok) {
    return res.status(planAccess.status).json({ error: planAccess.error })
  }

  const priceId = planAccess.priceId
  const storedPlan = planAccess.storedPlan || plan

  if (!priceId) {
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

    const paddleResponse = await fetch(`${paddle.apiBaseUrl}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paddle.apiKey}`,
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
          plan: storedPlan,
          requestedPlan: plan,
          paddleEnvironment: paddle.environment,
        },
        return_url: successUrl,
      }),
    })

    const paddlePayload = await paddleResponse.json()

    if (!paddleResponse.ok) {
      return res.status(502).json({
        error: 'Failed to create Paddle transaction',
        details: {
          status: paddleResponse.status,
          paddle: paddlePayload,
          environment: paddle.environment,
        },
      })
    }

    const transactionId = paddlePayload?.data?.id
    const checkoutUrl = paddlePayload?.data?.checkout?.url

    if (!transactionId) {
      return res.status(502).json({ error: 'Paddle transaction ID was missing in response' })
    }

    if (!checkoutUrl) {
      return res.status(502).json({ error: 'Paddle checkout URL was missing in response' })
    }

    return res.json({
      checkoutUrl,
      userEmail: user.email,
      clientToken: paddle.clientToken,
      paddleEnvironment: paddle.environment,
      _version: 'WITH_USER_EMAIL_2026_03_26',
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
    })
  }
}

/**
 * POST /api/paddle/checkout
 * Create a Paddle transaction for embedded checkout
 */
router.post('/checkout', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  return createCheckout(req, res, 'checkout')
})

/**
 * POST /api/paddle/checkout-url
 * Legacy endpoint - returns same format as /checkout
 */
router.post('/checkout-url', requireAuth, generalApiLimiterAuth, validateBody(schemas.paddleCheckout), async (req, res) => {
  return createCheckout(req, res, 'checkout-url')
})

export default router
// Deploy: Thu Mar 26 18:22:20 UTC 2026
