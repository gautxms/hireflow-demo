import { Router } from 'express'
import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import {
  getMonthStart,
  getUsageCount,
  getUsageOverride,
} from '../middleware/subscriptionCheck.js'
import {
  getResumeQuotaUsageAvailabilitySnapshot,
  isResumeQuotaReservationsEnabled,
} from '../services/resumeQuotaReservations.js'
import { resolveResumeQuotaPeriod } from '../utils/resumeQuotaPeriod.js'
import { canUsePaidMutation, hasScheduledCancellationAccess } from '../utils/subscriptionAccess.js'

const router = Router()

export function getMonthEnd(monthStart) {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
}

export function resolveResumeAnalysisUsageWarningLevel(used, limit) {
  if (limit <= 0) return used > 0 ? 'exceeded' : 'none'
  if (used >= limit) return 'exceeded'
  if (used * 100 >= limit * 90) return 'critical'
  if (used * 100 >= limit * 75) return 'approaching'
  return 'none'
}

export function buildResumeAnalysisUsageResponse({
  limit,
  used,
  periodStart,
  periodEnd = getMonthEnd(periodStart),
  reserved = 0,
  nextRevalidationAt = periodEnd,
  canUseAnalysis = true,
}) {
  const normalizedLimit = Number(limit || 0)
  const normalizedUsed = Number(used || 0)
  const remaining = Math.max(normalizedLimit - normalizedUsed, 0)
  const available = Math.max(remaining - Math.max(Number(reserved || 0), 0), 0)
  const percentageUsed = normalizedLimit > 0
    ? Math.floor((normalizedUsed / normalizedLimit) * 100)
    : 0

  return {
    limit: normalizedLimit,
    used: normalizedUsed,
    remaining,
    available,
    canCreateAnalysis: canUseAnalysis && available > 0,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    percentageUsed,
    warningLevel: resolveResumeAnalysisUsageWarningLevel(normalizedUsed, normalizedLimit),
    nextRevalidationAt: new Date(nextRevalidationAt).toISOString(),
  }
}

router.get('/resume-analysis', async (req, res) => {
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

    const legacyMonthStart = getMonthStart()
    const usageOverride = await getUsageOverride(req.userId, legacyMonthStart)
    const quotaSubscriptionStatus = hasScheduledCancellationAccess(user)
      ? 'active'
      : user.subscription_status
    const limit = resolveMonthlyResumeAnalysisLimit(quotaSubscriptionStatus, usageOverride)
    const reservationsEnabled = isResumeQuotaReservationsEnabled()
    const period = reservationsEnabled
      ? resolveResumeQuotaPeriod({
        subscriptionStatus: quotaSubscriptionStatus,
        quotaAnchorAt: user.quota_anchor_at,
      })
      : { start: legacyMonthStart, end: getMonthEnd(legacyMonthStart) }
    const availabilitySnapshot = reservationsEnabled
      ? await getResumeQuotaUsageAvailabilitySnapshot({
        userId: req.userId,
        periodStart: period.start,
        periodEnd: period.end,
        shouldResetUsage: usageOverride?.reset_usage,
      })
      : null
    const used = availabilitySnapshot?.used
      ?? await getUsageCount(req.userId, legacyMonthStart, usageOverride?.reset_usage)
    const reserved = availabilitySnapshot?.reserved ?? 0
    const nextReservationChangeAt = availabilitySnapshot?.nextAvailabilityChangeAt ?? null
    const nextRevalidationAt = nextReservationChangeAt
      && new Date(nextReservationChangeAt).getTime() < period.end.getTime()
      ? new Date(nextReservationChangeAt)
      : period.end

    return res.json(buildResumeAnalysisUsageResponse({
      limit,
      used,
      periodStart: period.start,
      periodEnd: period.end,
      reserved,
      nextRevalidationAt,
      canUseAnalysis: canUsePaidMutation(user),
    }))
  } catch (error) {
    console.error('[Usage] Failed to load resume analysis usage:', error)
    return res.status(500).json({ error: 'Unable to load resume analysis usage' })
  }
})

export default router
