import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import {
  getResumeQuotaUsageAvailabilitySnapshot,
  isResumeQuotaReservationsEnabled,
} from './resumeQuotaReservations.js'
import { resolveResumeQuotaPeriod, RESUME_QUOTA_PERIOD_SOURCES } from '../utils/resumeQuotaPeriod.js'
import { canUsePaidMutation, hasScheduledCancellationAccess } from '../utils/subscriptionAccess.js'

function monthStart(referenceDate = new Date()) {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
}

function monthEnd(start) {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
}

function deriveAnalysisStatus(row) {
  const total = Number(row.total_count || 0)
  const complete = Number(row.complete_count || 0)
  const failed = Number(row.failed_count || 0)
  const processing = Number(row.processing_count || 0)

  if (total === 0) return row.status === 'failed' ? 'failed' : 'queued'
  if (complete + failed === total) return failed > 0 ? 'failed' : 'complete'
  if (processing > 0) return 'processing'
  return 'queued'
}

export async function listMcpJobs({ db, userId, query = '', limit = 20 }) {
  const search = String(query || '').trim()
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const result = await db.query(
    `SELECT id, title, status, department, location, updated_at
     FROM job_descriptions
     WHERE user_id = $1
       AND status <> 'archived'
       AND ($2 = '' OR title ILIKE '%' || $2 || '%')
     ORDER BY updated_at DESC
     LIMIT $3`,
    [userId, search, normalizedLimit],
  )

  return {
    jobs: result.rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      status: row.status,
      department: row.department || null,
      location: row.location || null,
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
  }
}

export async function getMcpAnalysisStatus({ db, userId, analysisId }) {
  const result = await db.query(
    `SELECT a.id,
            a.name,
            a.status,
            a.created_at,
            a.completed_at,
            a.job_description_id,
            jd.title AS job_description_title,
            COUNT(ai.id)::INT AS total_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') = 'complete'
            )::INT AS complete_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') IN ('failed', 'stalled')
            )::INT AS failed_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') IN ('processing', 'retrying')
            )::INT AS processing_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') IN ('queued', 'pending', 'waiting')
            )::INT AS queued_count
     FROM analyses a
     LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
     LEFT JOIN analysis_items ai ON ai.analysis_id = a.id
     LEFT JOIN resumes r ON r.id = ai.resume_id
     LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
     WHERE a.id = $1 AND a.user_id = $2
     GROUP BY a.id, jd.title
     LIMIT 1`,
    [analysisId, userId],
  )
  const row = result.rows[0]
  if (!row) return null

  return {
    id: String(row.id),
    name: row.name || 'Untitled analysis',
    status: deriveAnalysisStatus(row),
    job: row.job_description_id
      ? { id: String(row.job_description_id), title: row.job_description_title || 'Untitled job' }
      : null,
    counts: {
      total: Number(row.total_count || 0),
      complete: Number(row.complete_count || 0),
      failed: Number(row.failed_count || 0),
      processing: Number(row.processing_count || 0),
      queued: Number(row.queued_count || 0),
    },
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  }
}

export async function getMcpResumeQuota({ db, userId, env = process.env, now = new Date() }) {
  const accountResult = await db.query(
    `SELECT subscription_status, subscription_plan, quota_anchor_at,
            subscription_started_at, trial_ends_at, cancellation_effective_at,
            current_period_end
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  )
  const account = accountResult.rows[0]
  if (!account) return null

  const legacyStart = monthStart(now)
  const overrideResult = await db.query(
    `SELECT upload_limit, reset_usage
     FROM usage_overrides
     WHERE user_id = $1 AND month_start = $2
     LIMIT 1`,
    [userId, legacyStart],
  )
  const usageOverride = overrideResult.rows[0] || null
  const subscriptionStatus = hasScheduledCancellationAccess(account, now)
    ? 'active'
    : account.subscription_status
  const limit = resolveMonthlyResumeAnalysisLimit(
    subscriptionStatus,
    usageOverride,
    account.subscription_plan,
  )
  const resolvedPeriod = resolveResumeQuotaPeriod({
    subscriptionStatus,
    quotaAnchorAt: account.quota_anchor_at,
    trialStartedAt: account.subscription_started_at,
    trialEndsAt: account.trial_ends_at || account.current_period_end,
    referenceDate: now,
  })
  const reservationsEnabled = isResumeQuotaReservationsEnabled(env)
  const period = reservationsEnabled || resolvedPeriod.source === RESUME_QUOTA_PERIOD_SOURCES.TRIAL
    ? resolvedPeriod
    : { start: legacyStart, end: monthEnd(legacyStart), source: RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK }

  let used = 0
  let reserved = 0
  if (reservationsEnabled || period.source === RESUME_QUOTA_PERIOD_SOURCES.TRIAL) {
    const snapshot = await getResumeQuotaUsageAvailabilitySnapshot({
      userId,
      periodStart: period.start,
      periodEnd: period.end,
      shouldResetUsage: usageOverride?.reset_usage,
      queryable: db,
    })
    used = snapshot.used
    reserved = snapshot.reserved
  } else if (!usageOverride?.reset_usage) {
    const usageResult = await db.query(
      `SELECT COUNT(*)::INT AS usage_count
       FROM usage_log
       WHERE user_id = $1
         AND (
           (quota_allocation_id IS NULL AND month_start = $2::date)
           OR (
             quota_allocation_id IS NOT NULL
             AND created_at >= $2
             AND created_at < $3
           )
         )`,
      [userId, period.start, period.end],
    )
    used = Number(usageResult.rows[0]?.usage_count || 0)
  }

  const remaining = Math.max(limit - used, 0)
  return {
    limit,
    used,
    reserved,
    available: canUsePaidMutation(account, now) ? Math.max(remaining - reserved, 0) : 0,
    canCreateAnalysis: canUsePaidMutation(account, now) && remaining > reserved,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
  }
}
