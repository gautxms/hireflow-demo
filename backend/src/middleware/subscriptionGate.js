import { pool } from '../db/client.js'

function buildSubscriptionError(message, status = 403) {
  return {
    status,
    body: {
      error: message,
      stripe_status: 'canceled',
      is_active: false,
    },
  }
}

async function getUserSubscriptionStatus(userId) {
  const result = await pool.query(
    `SELECT stripe_status
     FROM users
     WHERE id = $1`,
    [userId],
  )

  return result.rows[0]?.stripe_status || null
}

export async function requirePremiumAccess(req, res, next) {
  try {
    const stripeStatus = await getUserSubscriptionStatus(req.userId)

    if (stripeStatus === 'trialing' || stripeStatus === 'active') {
      return next()
    }

    if (stripeStatus === 'past_due') {
      res.setHeader('X-Subscription-Warning', 'Subscription past due. Access will be limited if unresolved.')
      return next()
    }

    if (stripeStatus === 'canceled') {
      const response = buildSubscriptionError('Your subscription is canceled. Premium features are blocked.')
      return res.status(response.status).json(response.body)
    }

    const response = buildSubscriptionError('No active subscription found. Premium features are blocked.')
    return res.status(response.status).json(response.body)
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
}
