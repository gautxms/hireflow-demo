import { pool } from '../db/client.js'

const ACTIVE_STATUSES = new Set(['active', 'trialing'])
const PAID_STATUSES = new Set(['active'])
const PAID_MONTHLY_RESUME_ANALYSIS_LIMIT = 800
const TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT = 10

function getMonthStart(referenceDate = new Date()) {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
}

async function getUsageOverride(userId, monthStart) {
  const overrideResult = await pool.query(
    `SELECT upload_limit, reset_usage
     FROM usage_overrides
     WHERE user_id = $1 AND month_start = $2
     LIMIT 1`,
    [userId, monthStart],
  )

  return overrideResult.rows[0] || null
}

async function getUsageCount(userId, ipAddress, monthStart, shouldResetUsage = false) {
  if (shouldResetUsage) {
    return 0
  }

  const usageResult = await pool.query(
    `SELECT COUNT(*)::INT AS usage_count
     FROM usage_log
     WHERE user_id = $1
       AND ip_address = $2
       AND month_start = $3`,
    [userId, ipAddress, monthStart],
  )

  return usageResult.rows[0]?.usage_count ?? 0
}

function resolveUploadLimit(subscriptionStatus, usageOverride) {
  if (usageOverride?.upload_limit && Number.isInteger(usageOverride.upload_limit)) {
    return usageOverride.upload_limit
  }

  return PAID_STATUSES.has(subscriptionStatus)
    ? PAID_MONTHLY_RESUME_ANALYSIS_LIMIT
    : TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT
}

export async function requireActiveSubscription(req, res, next) {
  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!ACTIVE_STATUSES.has(user.subscription_status)) {
      return res.status(403).json({
        error: 'Subscription inactive',
        message:
          'Your subscription is inactive or cancelled. Please reactivate your subscription to continue uploading files.',
      })
    }

    req.subscriptionStatus = user.subscription_status
    return next()
  } catch (error) {
    console.error('[Subscription] Failed to validate subscription status:', error)
    return res.status(500).json({ error: 'Unable to validate subscription status' })
  }
}

export async function enforceUploadLimit(req, res, next) {
  try {
    const monthStart = getMonthStart()
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const usageOverride = await getUsageOverride(req.userId, monthStart)
    const uploadLimit = resolveUploadLimit(req.subscriptionStatus, usageOverride)
    const currentUsage = await getUsageCount(req.userId, ipAddress, monthStart, usageOverride?.reset_usage)
    const requestedUploads = Math.max(req.files?.length || 1, 1)
    const projectedUsage = currentUsage + requestedUploads

    if (projectedUsage > uploadLimit) {
      return res.status(429).json({
        error: 'Upload limit reached',
        message: `This upload would exceed your monthly resume analysis limit (${uploadLimit}). Contact support or upgrade your plan to continue.`,
        limit: uploadLimit,
        used: currentUsage,
        requested: requestedUploads,
      })
    }

    const percentUsed = Math.round((projectedUsage / uploadLimit) * 100)
    if (percentUsed >= 80) {
      res.set('X-Usage-Warning', `You have used ${percentUsed}% of your monthly upload quota.`)
    }

    req.usageContext = {
      monthStart,
      ipAddress,
      uploadLimit,
      currentUsage,
      requestedUploads,
      usageOverride,
    }

    return next()
  } catch (error) {
    console.error('[Subscription] Failed to enforce upload usage limit:', error)
    return res.status(500).json({ error: 'Unable to enforce upload usage limits' })
  }
}

export async function trackUploadUsage(req, _res, next) {
  if (!req.userId || !req.usageContext?.monthStart || !req.usageContext?.ipAddress) {
    return next()
  }

  try {
    const uploadCount = Math.max(req.usageContext.requestedUploads || 1, 1)

    await pool.query(
      `INSERT INTO usage_log (user_id, ip_address, month_start)
       SELECT $1, $2, $3
       FROM generate_series(1, $4)`,
      [req.userId, req.usageContext.ipAddress, req.usageContext.monthStart, uploadCount],
    )
  } catch (error) {
    console.error('[Subscription] Failed to track upload usage:', error)
  }

  return next()
}
