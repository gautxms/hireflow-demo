import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { generalApiLimiterAuth } from '../middleware/rateLimiter.js'
import { resolvePaddleConfigForUser } from '../config/paddle.js'

const router = Router()
const TEST_MONTHLY_PLAN = 'test-monthly'
const TEST_MONTHLY_STORED_PLAN = 'monthly'
const CHECKOUT_BLOCKED_STATUSES = new Set(['active', 'trialing', 'trial', 'past_due', 'payment_failed', 'paused'])

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function isFutureDate(value, now = new Date()) {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date > now
}

export function isTrialEligibleForUser(user = {}) {
  const status = normalizeStatus(user.subscription_status)
  const hasPreviousSubscriptionState = status && !['inactive', 'no_subscription', 'none', 'free'].includes(status)

  return !(
    hasPreviousSubscriptionState
    || user.has_payment_attempts
    || user.trial_consumed_at
    || user.trial_ends_at
    || user.subscription_started_at
    || user.paddle_subscription_id
  )
}

export function getCheckoutBlockReason(user = {}, providerSubscription = null, now = new Date()) {
  const localStatus = normalizeStatus(user.subscription_status)
  const providerStatus = normalizeStatus(providerSubscription?.status || providerSubscription?.data?.status)
  const effectiveStatus = providerStatus || localStatus
  const hasRecoverableProviderSubscription = Boolean(providerStatus || user.paddle_subscription_id)

  if (CHECKOUT_BLOCKED_STATUSES.has(effectiveStatus)) {
    const status = effectiveStatus
    if ((status === 'past_due' || status === 'payment_failed') && !hasRecoverableProviderSubscription) {
      return null
    }
    return {
      reason: status === 'past_due' || status === 'payment_failed' ? 'payment_required' : 'existing_subscription',
      redirectTo: status === 'past_due' || status === 'payment_failed' ? '/account/payment-method' : '/billing',
    }
  }

  if (isFutureDate(user.cancellation_effective_at, now)) {
    return { reason: 'cancellation_scheduled', redirectTo: '/billing' }
  }

  return null
}

function getAppOrigin(req) {
  return process.env.APP_ORIGIN || process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`
}

export function validatePaddleCheckoutPlan({ plan, testKey, paddle, trialEligible = true }) {
  if (plan !== TEST_MONTHLY_PLAN) {
    const priceId = trialEligible
      ? paddle.priceIdsByPlan[plan]
      : paddle.noTrialPriceIdsByPlan?.[plan]

    if (!trialEligible && !priceId) {
      return {
        ok: false,
        status: 503,
        error: 'Checkout for returning subscribers is not configured. Please contact support.',
      }
    }

    return {
      ok: true,
      priceId,
      storedPlan: plan,
      trialEligible,
      checkoutMode: trialEligible ? 'trial' : 'paid_returning',
    }
  }

  if (!paddle.testCheckout?.enabled || !paddle.priceIdsByPlan[TEST_MONTHLY_PLAN]) {
    return { ok: false, status: 404, error: 'Checkout is unavailable' }
  }

  if (!paddle.testCheckout.key || testKey !== paddle.testCheckout.key) {
    return { ok: false, status: 403, error: 'Checkout is unavailable' }
  }

  return { ok: true, priceId: paddle.priceIdsByPlan[TEST_MONTHLY_PLAN], storedPlan: TEST_MONTHLY_STORED_PLAN, trialEligible: false, checkoutMode: 'test' }
}

async function loadProviderSubscription(user, paddle) {
  if (!user.paddle_subscription_id) return null

  const response = await fetch(`${paddle.apiBaseUrl}/subscriptions/${user.paddle_subscription_id}`, {
    headers: {
      Authorization: `Bearer ${paddle.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': paddle.apiVersion,
    },
  })

  if (response.status === 404) return null

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error('Unable to verify the existing Paddle subscription')
    error.status = response.status
    throw error
  }

  return payload?.data || payload
}

async function createCheckout(req, res, logLabel) {
  const { plan, testKey } = req.body || {}

  let user

  try {
    const userResult = await pool.query(
      `SELECT id, email, subscription_status, subscription_started_at, trial_ends_at, trial_consumed_at,
              cancellation_effective_at, paddle_customer_id, paddle_subscription_id, paddle_environment,
              EXISTS (SELECT 1 FROM payment_attempts attempt WHERE attempt.user_id = users.id) AS has_payment_attempts
       FROM users
       WHERE id = $1`,
      [req.userId],
    )
    user = userResult.rows[0]
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create checkout',
      message: error.message,
    })
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  const paddle = resolvePaddleConfigForUser(user)
  console.info(`[Paddle ${logLabel}] resolved configuration`, {
    userId: user.id,
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

  let providerSubscription = null

  try {
    const localBlock = getCheckoutBlockReason(user)
    if (localBlock) {
      return res.status(409).json({
        error: 'Checkout is unavailable for the current subscription state.',
        code: localBlock.reason,
        redirectTo: localBlock.redirectTo,
      })
    }

    providerSubscription = await loadProviderSubscription(user, paddle)
    const providerBlock = getCheckoutBlockReason(user, providerSubscription)
    if (providerBlock) {
      return res.status(409).json({
        error: 'Checkout is unavailable because a Paddle subscription still requires attention.',
        code: providerBlock.reason,
        redirectTo: providerBlock.redirectTo,
      })
    }
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to verify the existing subscription before checkout. Please try again.',
      message: error.message,
    })
  }

  const trialEligible = isTrialEligibleForUser(user)

  const planAccess = validatePaddleCheckoutPlan({ plan, testKey, paddle, trialEligible })

  if (!planAccess.ok) {
    return res.status(planAccess.status).json({ error: planAccess.error })
  }

  const priceId = planAccess.priceId
  const storedPlan = planAccess.storedPlan || plan

  if (!priceId) {
    return res.status(500).json({ error: `Paddle price ID is missing for ${plan} plan` })
  }

  try {
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
        ...(user.paddle_customer_id
          ? { customer_id: user.paddle_customer_id }
          : { customer: { email: user.email } }),
        custom_data: {
          userId: user.id,
          email: user.email,
          plan: storedPlan,
          requestedPlan: plan,
          paddleEnvironment: paddle.environment,
          trialEligible: planAccess.trialEligible,
          checkoutMode: planAccess.checkoutMode,
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
      trialEligible: planAccess.trialEligible,
      checkoutMode: planAccess.checkoutMode,
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
