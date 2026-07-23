import crypto from 'node:crypto'
import {
  RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT,
  resolveMonthlyResumeAnalysisLimit,
} from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import { canUsePaidMutation, hasActivePaidAccess, hasScheduledCancellationAccess } from '../utils/subscriptionAccess.js'
import {
  isResumeQuotaBillingPeriodShadowEnabled,
  resolveResumeQuotaPeriod,
  RESUME_QUOTA_PERIOD_SOURCES,
} from '../utils/resumeQuotaPeriod.js'
import {
  assertResumeQuotaReservationAvailable,
  isResumeQuotaReservationsEnabled,
  reserveResumeQuotaUnits,
  ResumeQuotaExceededError,
} from '../services/resumeQuotaReservations.js'

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

  const normalizedMonthStart = new Date(monthStart)
  const monthEnd = new Date(Date.UTC(
    normalizedMonthStart.getUTCFullYear(),
    normalizedMonthStart.getUTCMonth() + 1,
    1,
  ))
  const usageResult = await pool.query(
    `SELECT COUNT(*)::INT AS usage_count
     FROM usage_log
     WHERE user_id = $1
       AND (
         (quota_allocation_id IS NULL AND month_start = $2::date)
         OR (
           quota_allocation_id IS NOT NULL
           AND created_at >= $2::timestamp
           AND created_at < $3::timestamp
         )
       )`,
    [userId, normalizedMonthStart, monthEnd],
  )

  return usageResult.rows[0]?.usage_count ?? 0
}

export async function getUsageCountForPeriod(userId, periodStart, periodEnd, shouldResetUsage = false) {
  if (shouldResetUsage) {
    return 0
  }

  const usageResult = await pool.query(
    `SELECT COUNT(*)::INT AS usage_count
     FROM usage_log
     WHERE user_id = $1
       AND (
         (quota_allocation_id IS NOT NULL AND month_start = $2::date)
         OR (
           quota_allocation_id IS NULL
           AND created_at >= $2
           AND created_at < $3
         )
       )`,
    [userId, periodStart, periodEnd],
  )

  return usageResult.rows[0]?.usage_count ?? 0
}

export async function observeBillingPeriodQuota({
  userId,
  subscriptionContext,
  legacyPeriodStart,
  legacyUsage,
  uploadLimit,
  requestedUploads,
  shouldResetUsage = false,
  referenceDate = new Date(),
}) {
  const proposedPeriod = resolveResumeQuotaPeriod({
    subscriptionStatus: subscriptionContext?.status,
    quotaAnchorAt: subscriptionContext?.quotaAnchorAt,
    referenceDate,
  })

  const observation = {
    mode: 'shadow',
    source: proposedPeriod.source,
    fallbackReason: proposedPeriod.fallbackReason || null,
    legacyPeriodStart,
    proposedPeriodStart: proposedPeriod.start,
    proposedPeriodEnd: proposedPeriod.end,
    legacyUsage,
    proposedUsage: legacyUsage,
  }

  if (!isResumeQuotaBillingPeriodShadowEnabled()) {
    return { ...observation, mode: 'disabled' }
  }

  if (proposedPeriod.source !== RESUME_QUOTA_PERIOD_SOURCES.BILLING_ANCHOR) {
    return observation
  }

  try {
    const proposedUsage = await getUsageCountForPeriod(
      userId,
      proposedPeriod.start,
      proposedPeriod.end,
      shouldResetUsage,
    )
    const legacyWouldBlock = legacyUsage + requestedUploads > uploadLimit
    const proposedWouldBlock = proposedUsage + requestedUploads > uploadLimit

    console.info('[Resume quota billing-period shadow]', {
      userId,
      subscriptionPlan: subscriptionContext?.plan || null,
      legacyPeriodStart: legacyPeriodStart.toISOString(),
      proposedPeriodStart: proposedPeriod.start.toISOString(),
      proposedPeriodEnd: proposedPeriod.end.toISOString(),
      legacyUsage,
      proposedUsage,
      requestedUploads,
      uploadLimit,
      legacyWouldBlock,
      proposedWouldBlock,
      decisionDiffers: legacyWouldBlock !== proposedWouldBlock,
    })

    return {
      ...observation,
      proposedUsage,
      legacyWouldBlock,
      proposedWouldBlock,
      decisionDiffers: legacyWouldBlock !== proposedWouldBlock,
    }
  } catch (error) {
    console.warn('[Resume quota billing-period shadow] comparison failed; legacy enforcement unchanged', {
      userId,
      code: error?.code || error?.name || 'UNKNOWN_ERROR',
      message: error?.message || String(error),
    })
    return { ...observation, comparisonFailed: true }
  }
}

export async function requireActiveSubscription(req, res, next) {
  try {
    const userResult = await pool.query(
      `SELECT id, subscription_status, subscription_plan, quota_anchor_at,
              cancellation_effective_at, current_period_end
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const rawSubscriptionStatus = user.subscription_status
    const hasScheduledCancellationPaidAccess = hasScheduledCancellationAccess(user)
    const hasPaidMutationAccess = canUsePaidMutation(user)

    if (!hasPaidMutationAccess) {
      return res.status(403).json({
        error: 'Subscription inactive',
        message:
          'Your subscription has ended. Please resubscribe to continue paid workflow actions.',
      })
    }

    req.rawSubscriptionStatus = rawSubscriptionStatus
    req.hasActivePaidAccess = hasActivePaidAccess(user)
    req.hasScheduledCancellationAccess = hasScheduledCancellationPaidAccess
    req.subscriptionStatus = hasScheduledCancellationPaidAccess ? 'active' : rawSubscriptionStatus
    req.subscriptionStatusForQuota = hasScheduledCancellationPaidAccess ? 'active' : rawSubscriptionStatus
    req.subscriptionQuotaContext = {
      status: req.subscriptionStatusForQuota,
      plan: user.subscription_plan || null,
      quotaAnchorAt: user.quota_anchor_at || null,
    }
    return next()
  } catch (error) {
    console.error('[Subscription] Failed to validate subscription status:', error)
    return res.status(500).json({ error: 'Unable to validate subscription status' })
  }
}

export async function enforceUploadLimit(req, res, next) {
  try {
    const legacyMonthStart = getMonthStart()
    const legacyMonthEnd = new Date(Date.UTC(
      legacyMonthStart.getUTCFullYear(),
      legacyMonthStart.getUTCMonth() + 1,
      1,
    ))
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const usageOverride = await getUsageOverride(req.userId, legacyMonthStart)
    const quotaSubscriptionStatus = req.subscriptionStatusForQuota || req.subscriptionStatus
    const uploadLimit = resolveMonthlyResumeAnalysisLimit(quotaSubscriptionStatus, usageOverride)
    const reservationsEnabled = isResumeQuotaReservationsEnabled()
    const enforcementPeriod = reservationsEnabled
      ? resolveResumeQuotaPeriod({
        subscriptionStatus: req.subscriptionQuotaContext?.status || quotaSubscriptionStatus,
        quotaAnchorAt: req.subscriptionQuotaContext?.quotaAnchorAt || null,
      })
      : {
        start: legacyMonthStart,
        end: legacyMonthEnd,
        source: RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK,
        fallbackReason: 'reservation_rollout_disabled',
      }
    const periodStart = enforcementPeriod.start
    const periodEnd = enforcementPeriod.end
    const legacyUsage = await getUsageCount(
      req.userId,
      legacyMonthStart,
      usageOverride?.reset_usage,
    )
    const currentUsage = reservationsEnabled
      ? await getUsageCountForPeriod(
        req.userId,
        periodStart,
        periodEnd,
        usageOverride?.reset_usage,
      )
      : legacyUsage
    const requestedUploads = Math.max(Number(req.quotaRequestedUploads) || req.files?.length || 1, 1)
    const projectedUsage = currentUsage + requestedUploads
    const remainingUploads = Math.max(uploadLimit - currentUsage, 0)
    const quotaPeriodShadow = reservationsEnabled
      ? {
        mode: 'enforcing',
        source: enforcementPeriod.source,
        fallbackReason: enforcementPeriod.fallbackReason || null,
        legacyPeriodStart: legacyMonthStart,
        proposedPeriodStart: periodStart,
        proposedPeriodEnd: periodEnd,
        legacyUsage,
        proposedUsage: currentUsage,
      }
      : await observeBillingPeriodQuota({
        userId: req.userId,
        subscriptionContext: req.subscriptionQuotaContext || {
          status: quotaSubscriptionStatus,
        },
        legacyPeriodStart: legacyMonthStart,
        legacyUsage,
        uploadLimit,
        requestedUploads,
        shouldResetUsage: usageOverride?.reset_usage,
      })

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

    let quotaReservation = null
    if (isResumeQuotaReservationsEnabled()) {
      const suppliedReservationId = String(req.body?.quotaReservationId || '').trim()
      if (suppliedReservationId) {
        quotaReservation = await assertResumeQuotaReservationAvailable({
          userId: req.userId,
          reservationId: suppliedReservationId,
          requestedUnits: requestedUploads,
          periodStart,
          periodEnd,
          fileIdentity: req.body?.fileIdentity,
        })
      } else {
        const idempotencyKey = String(
          req.headers['x-quota-idempotency-key']
          || req.body?.quotaIdempotencyKey
          || crypto.randomUUID(),
        ).trim()
        const reservationResult = await reserveResumeQuotaUnits({
          userId: req.userId,
          periodStart,
          periodEnd,
          uploadLimit,
          requestedUnits: requestedUploads,
          idempotencyKey,
          shouldResetUsage: usageOverride?.reset_usage,
        })
        quotaReservation = reservationResult.reservation
      }
    }

    const percentUsed = Math.round((projectedUsage / uploadLimit) * 100)
    if (percentUsed >= RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT) {
      res.set('X-Usage-Warning', `You have used ${percentUsed}% of your monthly upload quota.`)
    }

    req.usageContext = {
      monthStart: periodStart,
      periodStart,
      periodEnd,
      periodSource: enforcementPeriod.source,
      ipAddress,
      uploadLimit,
      currentUsage,
      requestedUploads,
      remainingUploads,
      usageOverride,
      quotaPeriodShadow,
      quotaReservation,
    }

    return next()
  } catch (error) {
    if (error instanceof ResumeQuotaExceededError) {
      return res.status(429).json({
        error: 'Upload limit reached',
        message: `This upload would exceed your monthly resume analysis limit (${error.details.limit}). Contact support or upgrade your plan to continue.`,
        limit: error.details.limit,
        used: error.details.used,
        reserved: error.details.reserved,
        requested: error.details.requested,
        remaining: error.details.remaining,
      })
    }
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

export async function recordChunkUploadUsage({ userId, uploadId, monthStart, ipAddress }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const uploadUpdate = await client.query(
      `UPDATE upload_chunks
       SET quota_recorded = true,
           updated_at = NOW()
       WHERE upload_id = $1
         AND user_id = $2
         AND quota_recorded = false
       RETURNING upload_id`,
      [uploadId, userId],
    )
    if (!uploadUpdate.rows[0]) {
      await client.query('COMMIT')
      return false
    }
    await client.query(
      `INSERT INTO usage_log (user_id, ip_address, month_start)
       VALUES ($1, $2, $3)`,
      [userId, ipAddress, monthStart],
    )
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function trackUploadUsage(req, res, next) {
  if (!req.userId || !req.usageContext?.monthStart || !req.usageContext?.ipAddress) {
    return next()
  }

  try {
    if (req.usageContext.quotaReservation?.id) {
      // The provider-start accounting path allocates units inside the upload
      // handler and consumes them from the parse worker immediately before the
      // first external AI request. Do not charge here.
      return next()
    } else {
      await recordUploadUsage({
        userId: req.userId,
        monthStart: req.usageContext.monthStart,
        ipAddress: req.usageContext.ipAddress,
        uploadCount: req.usageContext.requestedUploads,
      })
    }
  } catch (error) {
    console.error('[Subscription] Failed to track upload usage:', error)
    if (req.usageContext.quotaReservation?.id) {
      return res.status(500).json({ error: 'Unable to allocate resume analysis quota' })
    }
  }

  return next()
}
