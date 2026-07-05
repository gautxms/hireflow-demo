import {
  RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT,
  resolveMonthlyResumeAnalysisLimit,
} from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import { canUsePaidMutation } from '../utils/subscriptionAccess.js'

export function getMonthStart(referenceDate = new Date()) {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
}

export async function getUsageOverride(userId, monthStart) {
  const overrideResult = await pool.query(
    `SELECT upload_limit, reset_usage
     FROM usage_overrides
     WHERE user_id = $1 AND month_start = $2
     LIMIT 1`,
    [userId, monthStart],
  )

  return overrideResult.rows[0] || null
}

export async function getUsageCount(userId, monthStart, shouldResetUsage = false) {
  if (shouldResetUsage) {
    return 0
  }

  const usageResult = await pool.query(
    `SELECT COUNT(*)::INT AS usage_count
     FROM usage_log
     WHERE user_id = $1
       AND month_start = $2`,
    [userId, monthStart],
  )

  return usageResult.rows[0]?.usage_count ?? 0
}

export async function requireActiveSubscription(req, res, next) {
  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status, cancellation_effective_at, current_period_end
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!canUsePaidMutation(user)) {
      return res.status(403).json({
        error: 'Subscription inactive',
        message:
          'Your subscription has ended. Please resubscribe to continue paid workflow actions.',
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
    const uploadLimit = resolveMonthlyResumeAnalysisLimit(req.subscriptionStatus, usageOverride)
    const currentUsage = await getUsageCount(req.userId, monthStart, usageOverride?.reset_usage)
    const requestedUploads = Math.max(req.files?.length || 1, 1)
    const projectedUsage = currentUsage + requestedUploads
    const remainingUploads = Math.max(uploadLimit - currentUsage, 0)

    if (projectedUsage > uploadLimit) {
      return res.status(429).json({
        error: 'Upload limit reached',
        message: `This upload would exceed your monthly resume analysis limit (${uploadLimit}). Contact support or upgrade your plan to continue.`,
        limit: uploadLimit,
        used: currentUsage,
        requested: requestedUploads,
        remaining: remainingUploads,
      })
    }

    const percentUsed = Math.round((projectedUsage / uploadLimit) * 100)
    if (percentUsed >= RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT) {
      res.set('X-Usage-Warning', `You have used ${percentUsed}% of your monthly upload quota.`)
    }

    req.usageContext = {
      monthStart,
      ipAddress,
      uploadLimit,
      currentUsage,
      requestedUploads,
      remainingUploads,
      usageOverride,
    }

    return next()
  } catch (error) {
    console.error('[Subscription] Failed to enforce upload usage limit:', error)
    return res.status(500).json({ error: 'Unable to enforce upload usage limits' })
  }
}

export async function recordUploadUsage({ userId, monthStart, ipAddress, uploadCount = 1 }) {
  const count = Math.max(uploadCount || 1, 1)

  await pool.query(
    `INSERT INTO usage_log (user_id, ip_address, month_start)
     SELECT $1, $2, $3
     FROM generate_series(1, $4)`,
    [userId, ipAddress, monthStart, count],
  )
}

export async function trackUploadUsage(req, _res, next) {
  if (!req.userId || !req.usageContext?.monthStart || !req.usageContext?.ipAddress) {
    return next()
  }

  try {
    await recordUploadUsage({
      userId: req.userId,
      monthStart: req.usageContext.monthStart,
      ipAddress: req.usageContext.ipAddress,
      uploadCount: req.usageContext.requestedUploads,
    })
  } catch (error) {
    console.error('[Subscription] Failed to track upload usage:', error)
  }

  return next()
}
