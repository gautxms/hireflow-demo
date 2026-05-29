import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const E164_REGEX = /^\+[1-9]\d{1,14}$/
const GRACE_PERIOD_DAYS = 30
const KPI_SCHEMA_VERSION = '2026-05-08.v2'
const MAX_DASHBOARD_RANGE_DAYS = 180
const DEFAULT_DASHBOARD_RANGE_DAYS = 30
const DASHBOARD_ERROR_CODE = {
  INVALID_RANGE: 'DASHBOARD_INVALID_RANGE',
  DB_QUERY_FAILED: 'DASHBOARD_QUERY_FAILED',
  INTERNAL: 'DASHBOARD_INTERNAL_ERROR',
}

function sanitizeText(value, maxLength = 100) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function startOfUtcDay(dateInput) {
  const date = new Date(dateInput)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

export function resolveDashboardDateRange(query = {}, now = new Date()) {
  const endDateInput = query.endDate ? new Date(query.endDate) : now
  const parsedRangeDays = Number.parseInt(String(query.rangeDays || ''), 10)
  const requestedRangeDays = Number.isFinite(parsedRangeDays) ? parsedRangeDays : DEFAULT_DASHBOARD_RANGE_DAYS
  const rangeDays = Math.max(1, Math.min(MAX_DASHBOARD_RANGE_DAYS, requestedRangeDays))

  if (Number.isNaN(endDateInput.getTime())) {
    throw new Error('Invalid endDate')
  }

  const endDate = startOfUtcDay(endDateInput)

  let startDate = query.startDate ? new Date(query.startDate) : null
  if (startDate && Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid startDate')
  }

  if (!startDate) {
    startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - (rangeDays - 1))
  } else {
    startDate = startOfUtcDay(startDate)
  }

  if (startDate > endDate) {
    throw new Error('startDate must be on or before endDate')
  }

  const effectiveRangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1
  if (effectiveRangeDays > MAX_DASHBOARD_RANGE_DAYS) {
    throw new Error(`Date range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days`)
  }

  return {
    startDate,
    endDate,
    effectiveRangeDays,
  }
}

function resolveBucketTrunc(granularity, effectiveRangeDays) {
  if (granularity === 'week') return 'week'
  if (granularity === 'day') return 'day'
  return effectiveRangeDays > 90 ? 'week' : 'day'
}

/**
 * KPI denominator contract:
 * - Non-finite denominators (null/undefined/NaN) are treated as 0.
 * - Denominators <= 0 resolve to 0%.
 * - Non-finite numerators are coerced to 0.
 * - Numerators are capped at denominator (rate metrics never exceed 100%).
 */
export function formatRate(numerator, denominator) {
  const safeDenominator = Number(denominator)
  if (!Number.isFinite(safeDenominator) || safeDenominator <= 0) return 0
  const safeNumerator = Number(numerator)
  if (!Number.isFinite(safeNumerator) || safeNumerator <= 0) return 0
  const boundedNumerator = Math.min(safeNumerator, safeDenominator)
  return Number(((boundedNumerator / safeDenominator) * 100).toFixed(2))
}

function csvEscape(value) {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

router.use(requireAuth)

router.get('/dashboard/kpis', async (req, res) => {
  try {
    const { startDate, endDate, effectiveRangeDays } = resolveDashboardDateRange(req.query)
    const bucketTrunc = resolveBucketTrunc(req.query.granularity, effectiveRangeDays)
    const jobDescriptionId = typeof req.query.jobDescriptionId === 'string' && req.query.jobDescriptionId.trim()
      ? req.query.jobDescriptionId.trim()
      : null
    const exportFormat = typeof req.query.export === 'string' ? req.query.export.trim().toLowerCase() : ''

    const filters = {
      userId: req.user.id,
      startDate: startDate.toISOString(),
      endDateExclusive: new Date(endDate.getTime() + (24 * 60 * 60 * 1000)).toISOString(),
      bucketTrunc,
      jobDescriptionId,
    }

    const runSegmentQuery = async (segment, query, params) => {
      const startedAt = Date.now()
      console.info('[profile.dashboard.kpis] Running SQL segment', {
        userId: req.user?.id,
        segment,
      })
      try {
        const result = await pool.query(query, params)
        console.info('[profile.dashboard.kpis] SQL segment completed', {
          userId: req.user?.id,
          segment,
          rowCount: result.rowCount,
          durationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        console.error('[profile.dashboard.kpis] SQL segment failed', {
          userId: req.user?.id,
          segment,
          durationMs: Date.now() - startedAt,
          dbCode: error.code || null,
          dbRoutine: error.routine || null,
          dbConstraint: error.constraint || null,
          message: error.message,
        })
        error.dashboardCode = DASHBOARD_ERROR_CODE.DB_QUERY_FAILED
        throw error
      }
    }

    const [summaryResult, timeSeriesResult, topJobsResult, jobOptionsResult] = await Promise.all([
      runSegmentQuery(
        'summary',
        `WITH analysis_window AS (
           SELECT a.id, a.status, ai.resume_id
           FROM analyses a
           INNER JOIN analysis_items ai ON ai.analysis_id = a.id
           WHERE a.user_id = $1
             AND a.created_at >= $2::timestamptz
             AND a.created_at < $3::timestamptz
             AND ($4::text IS NULL OR a.job_description_id::text = $4::text)
         ),
         completed_scored_resume_window AS (
           SELECT DISTINCT r.id, r.profile_score
           FROM resumes r
           INNER JOIN analysis_window aw ON aw.resume_id = r.id
           WHERE r.user_id = $1
             AND aw.status = 'complete'
             AND r.created_at >= $2::timestamptz
             AND r.created_at < $3::timestamptz
             AND r.profile_score IS NOT NULL
         ),
         resume_window AS (
           SELECT DISTINCT r.id, r.profile_score
           FROM resumes r
           WHERE r.user_id = $1
             AND r.created_at >= $2::timestamptz
             AND r.created_at < $3::timestamptz
             AND EXISTS (
               SELECT 1
               FROM analysis_window aw
               WHERE aw.resume_id = r.id
             )
         ),
         shortlist_window AS (
           SELECT DISTINCT sc.resume_id
           FROM shortlist_candidates sc
           INNER JOIN shortlists s ON s.id = sc.shortlist_id
           INNER JOIN analysis_window aw ON aw.resume_id = sc.resume_id
           WHERE s.user_id = $1
             AND sc.added_at >= $2::timestamptz
             AND sc.added_at < $3::timestamptz
         )
         SELECT
           (SELECT COUNT(DISTINCT id)::int FROM analysis_window) AS analyses_run_count,
           (SELECT COUNT(DISTINCT id)::int FROM analysis_window WHERE status = 'complete') AS analyses_completed_count,
           (SELECT COUNT(DISTINCT id)::int FROM analysis_window WHERE status IN ('failed', 'partial')) AS analyses_failed_count,
           (SELECT ROUND(AVG(profile_score)::numeric, 2) FROM completed_scored_resume_window) AS avg_score,
           (SELECT COUNT(*)::int FROM completed_scored_resume_window) AS scored_count,
           (SELECT COUNT(*)::int FROM resume_window) AS resumes_count,
           (SELECT COUNT(*)::int FROM shortlist_window) AS shortlisted_count`,
        [filters.userId, filters.startDate, filters.endDateExclusive, filters.jobDescriptionId],
      ),
      runSegmentQuery(
        'timeseries',
        `WITH days AS (
           SELECT generate_series($2::date, ($3::date - interval '1 day')::date, interval '1 day') AS day
         ),
         filtered_analysis_items AS (
           SELECT DISTINCT
             a.id AS analysis_id,
             a.status,
             a.created_at,
             ai.resume_id
           FROM analyses a
           INNER JOIN analysis_items ai ON ai.analysis_id = a.id
           WHERE a.user_id = $1
             AND a.created_at >= $2::timestamptz
             AND a.created_at < $3::timestamptz
             AND ($5::text IS NULL OR a.job_description_id::text = $5::text)
         ),
         filtered_resumes AS (
           SELECT DISTINCT resume_id
           FROM filtered_analysis_items
         ),
         analyses_by_day AS (
           SELECT date_trunc('day', created_at)::date AS day,
                  COUNT(*)::int AS analyses_run,
                  COUNT(*) FILTER (WHERE status = 'complete')::int AS analyses_completed,
                  COUNT(*) FILTER (WHERE status IN ('failed', 'partial'))::int AS analyses_failed
           FROM (
             SELECT DISTINCT analysis_id, status, created_at
             FROM filtered_analysis_items
           ) analyses_for_counts
           GROUP BY 1
         ),
         scored_resumes AS (
           SELECT DISTINCT
             fai.resume_id,
             r.created_at,
             r.profile_score
           FROM filtered_analysis_items fai
           INNER JOIN resumes r ON r.id = fai.resume_id
           WHERE r.user_id = $1
             AND fai.status = 'complete'
             AND r.created_at >= $2::timestamptz
             AND r.created_at < $3::timestamptz
             AND r.profile_score IS NOT NULL
         ),
         scores_by_day AS (
           SELECT date_trunc('day', created_at)::date AS day,
                  SUM(profile_score)::numeric AS score_sum,
                  COUNT(*)::int AS score_count
           FROM scored_resumes
           GROUP BY 1
         ),
         shortlists_by_day AS (
           SELECT date_trunc('day', sc.added_at)::date AS day,
                  COUNT(DISTINCT sc.resume_id)::int AS shortlisted_resumes
           FROM shortlist_candidates sc
           INNER JOIN shortlists s ON s.id = sc.shortlist_id
           INNER JOIN filtered_resumes fr ON fr.resume_id = sc.resume_id
           WHERE s.user_id = $1
             AND sc.added_at >= $2::timestamptz
             AND sc.added_at < $3::timestamptz
           GROUP BY 1
         ),
         resumes_by_day AS (
           SELECT date_trunc('day', r.created_at)::date AS day,
                  COUNT(*)::int AS resumes_uploaded
           FROM resumes r
           INNER JOIN filtered_resumes fr ON fr.resume_id = r.id
           WHERE r.user_id = $1
             AND r.created_at >= $2::timestamptz
             AND r.created_at < $3::timestamptz
           GROUP BY 1
         ),
         base_daily AS (
           SELECT d.day,
                  COALESCE(a.analyses_run, 0) AS analyses_run,
                  COALESCE(a.analyses_completed, 0) AS analyses_completed,
                  COALESCE(a.analyses_failed, 0) AS analyses_failed,
                  sb.score_sum,
                  COALESCE(sb.score_count, 0) AS score_count,
                  COALESCE(sl.shortlisted_resumes, 0) AS shortlisted_resumes,
                  COALESCE(rb.resumes_uploaded, 0) AS resumes_uploaded
           FROM days d
           LEFT JOIN analyses_by_day a ON a.day = d.day
           LEFT JOIN scores_by_day sb ON sb.day = d.day
           LEFT JOIN shortlists_by_day sl ON sl.day = d.day
           LEFT JOIN resumes_by_day rb ON rb.day = d.day
         )
         SELECT
           date_trunc($4, day)::date AS bucket,
           SUM(analyses_run)::int AS analyses_run,
           SUM(analyses_completed)::int AS analyses_completed,
           SUM(analyses_failed)::int AS analyses_failed,
           ROUND((SUM(score_sum) / NULLIF(SUM(score_count), 0))::numeric, 2) AS avg_score,
           SUM(score_count)::int AS score_count,
           SUM(shortlisted_resumes)::int AS shortlisted_resumes,
           SUM(resumes_uploaded)::int AS resumes_uploaded
         FROM base_daily
         GROUP BY 1
         ORDER BY 1 ASC`,
        [filters.userId, filters.startDate, filters.endDateExclusive, filters.bucketTrunc, filters.jobDescriptionId],
      ),
      runSegmentQuery(
        'topJobs',
        `SELECT
           jd.id,
           jd.title,
           COUNT(a.id)::int AS analyses_run,
           COUNT(*) FILTER (WHERE a.status = 'complete')::int AS analyses_completed,
           COUNT(*) FILTER (WHERE a.status IN ('failed', 'partial'))::int AS analyses_failed,
           MAX(a.created_at) AS latest_activity_at
         FROM analyses a
         INNER JOIN job_descriptions jd ON jd.id = a.job_description_id
         WHERE a.user_id = $1
           AND a.created_at >= $2::timestamptz
           AND a.created_at < $3::timestamptz
           AND ($4::text IS NULL OR a.job_description_id::text = $4::text)
         GROUP BY jd.id, jd.title
         ORDER BY analyses_run DESC, latest_activity_at DESC
         LIMIT 5`,
        [filters.userId, filters.startDate, filters.endDateExclusive, filters.jobDescriptionId],
      ),
      runSegmentQuery(
        'jobOptions',
        `SELECT id, title
         FROM job_descriptions
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [filters.userId],
      ),
    ])

    const summary = summaryResult.rows[0] || {}
    const analysesRunCount = Number(summary.analyses_run_count || 0)
    const analysesCompletedCount = Number(summary.analyses_completed_count || 0)
    const analysesFailedCount = Number(summary.analyses_failed_count || 0)
    const resumesCount = Number(summary.resumes_count || 0)
    const shortlistedCount = Number(summary.shortlisted_count || 0)
    const scoredCount = Number(summary.scored_count || 0)

    const kpis = {
      analysesRunCount,
      completionRate: formatRate(analysesCompletedCount, analysesRunCount),
      analysesFailedCount,
      avgScore: summary.avg_score === null || summary.avg_score === undefined ? null : Number(summary.avg_score),
      scoredCount,
      shortlistedRate: formatRate(shortlistedCount, resumesCount),
    }

    const timeSeries = timeSeriesResult.rows.map((row) => {
      const analysesRun = Number(row.analyses_run || 0)
      const analysesCompleted = Number(row.analyses_completed || 0)
      const analysesFailed = Number(row.analyses_failed || 0)
      const resumesUploaded = Number(row.resumes_uploaded || 0)
      const shortlistedResumes = Number(row.shortlisted_resumes || 0)
      const scoreCount = Number(row.score_count || 0)
      const avgScore = scoreCount > 0 && row.avg_score !== null && row.avg_score !== undefined ? Number(row.avg_score) : null

      return {
        periodStart: row.bucket,
        analysesRunCount: analysesRun,
        completionRate: formatRate(analysesCompleted, analysesRun),
        analysesFailedCount: analysesFailed,
        avgScore: Number.isFinite(avgScore) ? avgScore : null,
        scoreCount,
        shortlistedRate: formatRate(shortlistedResumes, resumesUploaded),
        resumesUploaded,
      }
    })

    const topJobActivity = topJobsResult.rows.map((row) => {
      const analysesRun = Number(row.analyses_run || 0)
      const analysesCompleted = Number(row.analyses_completed || 0)
      const analysesFailed = Number(row.analyses_failed || 0)

      return {
        jobDescriptionId: row.id,
        title: row.title,
        analysesRunCount: analysesRun,
        completionRate: formatRate(analysesCompleted, analysesRun),
        analysesFailedCount: analysesFailed,
        latestActivityAt: row.latest_activity_at,
      }
    })

    const analysesTrend = timeSeries.map((row) => ({
      periodStart: row.periodStart,
      value: row.analysesRunCount,
    }))
    const averageScoreTrend = timeSeries.map((row) => ({
      periodStart: row.periodStart,
      value: row.avgScore,
      scoredCount: row.scoreCount,
    }))
    const completionRateTrend = timeSeries.map((row) => ({
      periodStart: row.periodStart,
      value: row.completionRate,
    }))
    const shortlistedRateTrend = timeSeries.map((row) => ({
      periodStart: row.periodStart,
      value: row.shortlistedRate,
    }))

    const hasScoreData = timeSeries.some((row) => row.avgScore !== null && row.avgScore !== undefined && row.scoreCount > 0)

    const payload = {
      schemaVersion: KPI_SCHEMA_VERSION,
      range: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        days: effectiveRangeDays,
        granularity: bucketTrunc,
      },
      filters: {
        jobDescriptionId,
      },
      flags: {
        hasScoreData,
      },
      kpis,
      charts: {
        analysesTrend,
        averageScoreTrend,
        completionRateTrend,
        shortlistedRateTrend,
      },
      topJobActivity,
      jobOptions: jobOptionsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
      })),
    }

    if (exportFormat === 'csv') {
      const filterRows = [
        ['schema_version', payload.schemaVersion],
        ['start_date', payload.range.startDate],
        ['end_date', payload.range.endDate],
        ['range_days', payload.range.days],
        ['granularity', payload.range.granularity],
        ['job_description_id', payload.filters.jobDescriptionId || ''],
        ['has_score_data', payload.flags.hasScoreData],
      ]
      const summaryRows = [
        ['analyses_run_count', payload.kpis.analysesRunCount],
        ['completion_rate', payload.kpis.completionRate],
        ['avg_score', payload.kpis.avgScore],
        ['scored_count', payload.kpis.scoredCount],
        ['shortlisted_rate', payload.kpis.shortlistedRate],
      ]
      const trendHeader = ['trend_name', 'period_start', 'value']
      const trendRows = [
        ...payload.charts.analysesTrend.map((row) => ['analyses', row.periodStart, row.value]),
        ...payload.charts.averageScoreTrend.map((row) => ['average_score', row.periodStart, row.value]),
        ...payload.charts.completionRateTrend.map((row) => ['completion_rate', row.periodStart, row.value]),
        ...payload.charts.shortlistedRateTrend.map((row) => ['shortlisted_rate', row.periodStart, row.value]),
      ]
      const csvSections = [
        ['section', 'key', 'value'],
        ...filterRows.map((row) => ['filters', row[0], row[1]]),
        ...summaryRows.map((row) => ['kpi_summary', row[0], row[1]]),
        [],
        trendHeader,
        ...trendRows,
      ]
      const csv = csvSections.map((line) => line.map(csvEscape).join(',')).join('\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="dashboard-kpis-${payload.range.startDate}-to-${payload.range.endDate}.csv"`)
      return res.status(200).send(csv)
    }

    if (exportFormat === 'report') {
      return res.json({
        generatedAt: new Date().toISOString(),
        reportType: 'dashboard_kpis',
        ...payload,
      })
    }

    return res.json(payload)
  } catch (error) {
    if (error.message?.includes('Invalid') || error.message?.includes('Date range') || error.message?.includes('startDate')) {
      return res.status(400).json({
        error: error.message,
        code: DASHBOARD_ERROR_CODE.INVALID_RANGE,
        message: error.message,
      })
    }

    console.error('[profile.dashboard.kpis] Failed to load dashboard KPIs', {
      userId: req.user?.id,
      error: error.message,
      dbCode: error.code || null,
    })
    return res.status(500).json({
      error: 'Unable to load dashboard KPIs',
      code: error.dashboardCode || DASHBOARD_ERROR_CODE.INTERNAL,
      message: 'Unable to load dashboard KPIs',
    })
  }
})

router.get('/me', async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      company: req.user.company || '',
      phone: req.user.phone || '',
      subscription_status: req.user.subscription_status || 'inactive',
      created_at: req.user.created_at,
      deleted_at: req.user.deleted_at,
      deletion_scheduled_for: req.user.deletion_scheduled_for,
    },
  })
})

router.patch('/me', async (req, res) => {
  const { company, phone, email } = req.body ?? {}
  console.info('[profile.patch] Profile update requested', { userId: req.user?.id, hasCompany: company !== undefined, hasPhone: phone !== undefined })

  if (email !== undefined) {
    return res.status(400).json({ error: 'Email cannot be changed from account settings' })
  }

  const updates = []
  const values = []

  if (company !== undefined) {
    values.push(sanitizeText(company, 100))
    updates.push(`company = $${values.length}`)
  }

  if (phone !== undefined) {
    const normalizedPhone = sanitizeText(phone, 20)

    if (normalizedPhone && !E164_REGEX.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Phone must use E.164 format (example: +14155552671).' })
    }

    values.push(normalizedPhone)
    updates.push(`phone = $${values.length}`)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' })
  }

  values.push(req.user.id)

  try {
    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, email, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for`,
      values,
    )

    return res.json({
      message: 'Profile updated successfully',
      user: result.rows[0],
    })
  } catch (error) {
    console.error('[profile.patch] Failed to update profile', { userId: req.user?.id, error: error.message })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/change-password', async (req, res) => {
  const oldPassword = sanitizeText(req.body?.oldPassword, 256)
  const newPassword = sanitizeText(req.body?.newPassword, 256)
  const confirmPassword = sanitizeText(req.body?.confirmPassword, 256)

  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'oldPassword, newPassword and confirmPassword are required' })
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' })
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation must match' })
  }

  try {
    const currentPassword = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
    const passwordHash = currentPassword.rows[0]?.password_hash

    if (!passwordHash) {
      return res.status(404).json({ error: 'User not found' })
    }

    const passwordCheck = await pool.query('SELECT crypt($1, $2) = $2 AS is_valid', [oldPassword, passwordHash])

    if (!passwordCheck.rows[0]?.is_valid) {
      return res.status(400).json({ error: 'Old password is incorrect' })
    }

    await pool.query('UPDATE users SET password_hash = crypt($1, gen_salt(\'bf\', 10)) WHERE id = $2', [newPassword, req.user.id])

    return res.json({ message: 'Password updated successfully' })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/export', async (req, res) => {
  try {
    const [userResult, resumeResult, subscriptionResult] = await Promise.all([
      pool.query(
        `SELECT id, email, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for
         FROM users
         WHERE id = $1`,
        [req.user.id],
      ),
      pool.query('SELECT id, filename, created_at FROM resumes WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
      pool.query(
        'SELECT id, paddle_subscription_id, status, created_at, updated_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
        [req.user.id],
      ),
    ])

    return res.json({
      exported_at: new Date().toISOString(),
      data: {
        user: userResult.rows[0] || null,
        resumes: resumeResult.rows,
        subscriptions: subscriptionResult.rows,
      },
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/me', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW(),
           deletion_scheduled_for = NOW() + INTERVAL '${GRACE_PERIOD_DAYS} days',
           subscription_status = 'inactive'
       WHERE id = $1
       RETURNING deleted_at, deletion_scheduled_for`,
      [req.user.id],
    )

    return res.json({
      message: `Account scheduled for deletion in ${GRACE_PERIOD_DAYS} days`,
      deleted_at: result.rows[0]?.deleted_at,
      deletion_scheduled_for: result.rows[0]?.deletion_scheduled_for,
    })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
