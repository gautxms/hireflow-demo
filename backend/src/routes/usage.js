import { Router } from 'express'
import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import { getMonthStart, getUsageCount, getUsageOverride } from '../middleware/subscriptionCheck.js'

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

export function buildResumeAnalysisUsageResponse({ limit, used, periodStart }) {
  const normalizedLimit = Number(limit || 0)
  const normalizedUsed = Number(used || 0)
  const remaining = Math.max(normalizedLimit - normalizedUsed, 0)
  const percentageUsed = normalizedLimit > 0
    ? Math.floor((normalizedUsed / normalizedLimit) * 100)
    : 0

  return {
    limit: normalizedLimit,
    used: normalizedUsed,
    remaining,
    periodStart: periodStart.toISOString(),
    periodEnd: getMonthEnd(periodStart).toISOString(),
    percentageUsed,
    warningLevel: resolveResumeAnalysisUsageWarningLevel(normalizedUsed, normalizedLimit),
  }
}

router.get('/resume-analysis', async (req, res) => {
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

    const periodStart = getMonthStart()
    const usageOverride = await getUsageOverride(req.userId, periodStart)
    const limit = resolveMonthlyResumeAnalysisLimit(user.subscription_status, usageOverride)
    const used = await getUsageCount(req.userId, periodStart, usageOverride?.reset_usage)

    return res.json(buildResumeAnalysisUsageResponse({ limit, used, periodStart }))
  } catch (error) {
    console.error('[Usage] Failed to load resume analysis usage:', error)
    return res.status(500).json({ error: 'Unable to load resume analysis usage' })
  }
})

export default router
