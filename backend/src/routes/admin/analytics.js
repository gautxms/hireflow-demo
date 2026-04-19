import { Router } from 'express'
import { pool } from '../../db/client.js'

const router = Router()

function toDateOnly(value) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

function normalizeDateRange(startDate, endDate) {
  const now = new Date()
  const fallbackEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const fallbackStart = new Date(fallbackEnd)
  fallbackStart.setUTCDate(fallbackEnd.getUTCDate() - 89)

  const parsedStart = toDateOnly(startDate)
  const parsedEnd = toDateOnly(endDate)

  const safeStart = Number.isNaN(parsedStart?.getTime()) ? fallbackStart : parsedStart
  const safeEnd = Number.isNaN(parsedEnd?.getTime()) ? fallbackEnd : parsedEnd

  if (safeStart > safeEnd) {
    return { start: safeEnd, end: safeStart }
  }

  return { start: safeStart, end: safeEnd }
}

function parsePlanType(planType) {
  if (planType === 'monthly' || planType === 'annual') {
    return planType
  }

  return 'all'
}

function forecastNextMonthMrr(monthlyTrend) {
  const data = (monthlyTrend || []).slice(-4).map((item) => Number(item.mrr || 0))
  if (!data.length) return 0
  if (data.length < 2) return Number(data[data.length - 1].toFixed(2))

  const deltas = []
  for (let index = 1; index < data.length; index += 1) {
    deltas.push(data[index] - data[index - 1])
  }

  const avgDelta = deltas.reduce((acc, value) => acc + value, 0) / deltas.length
  return Number((data[data.length - 1] + avgDelta).toFixed(2))
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const input = String(value)
  if (!input.includes(',') && !input.includes('"') && !input.includes('\n')) {
    return input
  }

  return `"${input.replaceAll('"', '""')}"`
}

function toCsv(sections) {
  return sections
    .map(({ title, rows }) => {
      if (!rows?.length) return `${title}\n(no data)`

      const keys = Object.keys(rows[0])
      const header = keys.map(csvEscape).join(',')
      const lines = rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))
      return `${title}\n${header}\n${lines.join('\n')}`
    })
    .join('\n\n')
}

function buildPriorityRecommendations(blockers = []) {
  const recipes = {
    admin_page_load_failed: 'Stabilize flaky admin pages: add retry affordances and investigate API dependencies for top failing routes.',
    admin_auth_dropoff: 'Reduce admin auth friction: streamline credential + 2FA flow copy and tighten error guidance.',
    admin_filter_used: 'Review frequently used filters and promote them to saved presets to reduce repeated manual filtering.',
    admin_export_clicked: 'Validate export journey throughput and async feedback for large CSV generation so admins trust completion.',
    admin_page_feedback_submitted: 'Audit negative page usefulness feedback and resolve route-specific pain points in UI copy and flow.',
  }

  return blockers.slice(0, 5).map((blocker, index) => ({
    rank: index + 1,
    blocker: blocker.event_type,
    frequency: Number(blocker.frequency || 0),
    recommendation: recipes[blocker.event_type] || 'Investigate this blocker with event-level metadata and route-specific user feedback.',
  }))
}


function parseRequestFilters(req) {
  const { startDate, endDate, planType } = req.query
  const range = normalizeDateRange(startDate, endDate)
  const safePlanType = parsePlanType(planType)
  return { start: range.start, end: range.end, planType: safePlanType }
}

function isRecoverableAnalyticsSchemaError(error) {
  const code = String(error?.code || '')
  return code === '42P01' || code === '42703'
}

function buildFallbackAnalytics({ start, end, planType }) {
  const unavailableSections = [
    'kpis',
    'revenueTrend',
    'userGrowth',
    'conversionFunnel',
    'parsingTrend',
    'planBreakdown',
    'retentionCohorts',
    'apiUsage',
    'uxBlockers',
    'uxWeeklyReport',
    'feedbackSummary',
    'feedbackTrend',
    'feedbackExport',
    'tokenUsageSummary',
    'tokenUsageTrend',
    'tokenUsageUploads',
  ]

  return {
    filters: {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      planType,
    },
    kpis: {
      totalUsers: 0,
      mrr: 0,
      arr: 0,
      churnRate: 0,
      arpu: 0,
      parsingSuccessRate: 0,
      forecastNextMonthMrr: 0,
      conversionRate: 0,
      feedbackCount: 0,
    },
    revenueTrend: [],
    userGrowth: [],
    conversionFunnel: { signups: 0, verified: 0, paid: 0 },
    parsingTrend: [],
    planBreakdown: [],
    retentionCohorts: [],
    apiUsage: [],
    uxBlockers: [],
    uxWeeklyReport: null,
    feedbackSummary: { total_feedback: 0, helpful_count: 0, unhelpful_count: 0, flagged_count: 0 },
    feedbackTrend: [],
    feedbackExport: [],
    tokenUsageSummary: {
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      avgTokensPerAnalysis: 0,
      totalEstimatedCostUsd: 0,
      avgEstimatedCostUsd: 0,
      usageAvailableCount: 0,
      usageUnavailableCount: 0,
    },
    tokenUsageTrend: [],
    tokenUsageUploads: [],
    dataMode: {
      limited: true,
      reason: 'schema_fallback',
      unavailableSections,
      diagnostics: 'Analytics is running in fallback mode because one or more database tables/columns are missing. Apply migrations, then retry.',
      canRetry: true,
    },
    generatedAt: new Date().toISOString(),
  }
}

async function loadAnalytics({ start, end, planType }) {
  const planFilter = planType === 'all' ? null : planType

  try {
    const [
      kpiResult,
      growthResult,
      revenueTrendResult,
      conversionResult,
      parsingResult,
      planBreakdownResult,
      retentionResult,
      apiUsageResult,
      feedbackSummaryResult,
      feedbackTrendResult,
      feedbackCommentsResult,
      uxBlockersResult,
      twoFactorRateResult,
      adminFeedbackSummaryResult,
      tokenUsageSummaryResult,
      tokenUsageTrendResult,
      tokenUsageUploadsResult,
    ] = await Promise.all([
    pool.query(
      `WITH scoped_users AS (
         SELECT id, created_at, email_verified, subscription_plan, subscription_status, cancellation_effective_at
         FROM users
         WHERE created_at::date BETWEEN $1::date AND $2::date
           AND ($3::text IS NULL OR subscription_plan = $3)
       ),
       scoped_invoices AS (
         SELECT id, user_id, amount_cents, billed_at, status
         FROM billing_invoices
         WHERE billed_at::date BETWEEN $1::date AND $2::date
           AND status = 'paid'
       ),
       month_revenue AS (
         SELECT COALESCE(SUM(amount_cents), 0)::numeric / 100 AS revenue
         FROM scoped_invoices
         WHERE billed_at >= date_trunc('month', $2::date)
           AND billed_at < date_trunc('month', $2::date) + interval '1 month'
       ),
       cancellation_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE cancellation_effective_at::date BETWEEN $1::date AND $2::date)::numeric AS cancelled,
           GREATEST(COUNT(*) FILTER (WHERE COALESCE(subscription_status, 'inactive') IN ('active', 'trialing')), 1)::numeric AS total_subs
         FROM users
         WHERE ($3::text IS NULL OR subscription_plan = $3)
       ),
       parse_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE event_type = 'parse_success')::numeric AS success_count,
           COUNT(*) FILTER (WHERE event_type IN ('parse_success', 'parse_fail'))::numeric AS total_count
         FROM events
         WHERE timestamp::date BETWEEN $1::date AND $2::date
       )
       SELECT
         (SELECT COUNT(*)::int FROM users WHERE created_at::date <= $2::date) AS total_users,
         ROUND((SELECT revenue FROM month_revenue), 2) AS mrr,
         ROUND((SELECT revenue FROM month_revenue) * 12, 2) AS arr,
         ROUND(CASE WHEN (SELECT total_subs FROM cancellation_stats) = 0 THEN 0 ELSE ((SELECT cancelled FROM cancellation_stats) / (SELECT total_subs FROM cancellation_stats)) * 100 END, 2) AS churn_rate,
         ROUND(CASE WHEN (SELECT COUNT(*) FROM scoped_invoices) = 0 THEN 0 ELSE (SELECT SUM(amount_cents)::numeric / 100 FROM scoped_invoices) / (SELECT COUNT(DISTINCT user_id) FROM scoped_invoices) END, 2) AS arpu,
         ROUND(CASE WHEN (SELECT total_count FROM parse_stats) = 0 THEN 0 ELSE ((SELECT success_count FROM parse_stats) / (SELECT total_count FROM parse_stats)) * 100 END, 2) AS parsing_success_rate`,
      [start, end, planFilter],
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
       )
       SELECT
         d.day,
         (
           SELECT COUNT(DISTINCT e.user_id)
           FROM events e
           WHERE e.user_id IS NOT NULL
             AND e.timestamp::date = d.day
         )::int AS dau,
         (
           SELECT COUNT(DISTINCT e.user_id)
           FROM events e
           WHERE e.user_id IS NOT NULL
             AND e.timestamp::date BETWEEN d.day - interval '6 day' AND d.day
         )::int AS wau,
         (
           SELECT COUNT(DISTINCT e.user_id)
           FROM events e
           WHERE e.user_id IS NOT NULL
             AND e.timestamp::date BETWEEN d.day - interval '29 day' AND d.day
         )::int AS mau
       FROM days d
       ORDER BY d.day ASC`,
      [start, end],
    ),
    pool.query(
      `WITH months AS (
         SELECT date_trunc('month', generate_series($2::date - interval '11 months', $2::date, interval '1 month'))::date AS month
       )
       SELECT
         m.month,
         ROUND(COALESCE(SUM(i.amount_cents), 0)::numeric / 100, 2) AS mrr
       FROM months m
       LEFT JOIN billing_invoices i
         ON date_trunc('month', i.billed_at) = m.month
        AND i.status = 'paid'
        AND ($3::text IS NULL OR EXISTS (
          SELECT 1 FROM users u WHERE u.id = i.user_id AND u.subscription_plan = $3
        ))
       GROUP BY m.month
       ORDER BY m.month ASC`,
      [start, end, planFilter],
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS signups,
         COUNT(*) FILTER (WHERE email_verified = true)::int AS verified,
         COUNT(*) FILTER (WHERE COALESCE(subscription_status, 'inactive') IN ('active', 'trialing', 'past_due'))::int AS paid
       FROM users
       WHERE created_at::date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR subscription_plan = $3)`,
      [start, end, planFilter],
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
       )
       SELECT
         d.day,
         COUNT(e.id) FILTER (WHERE e.event_type = 'parse_success')::int AS success,
         COUNT(e.id) FILTER (WHERE e.event_type = 'parse_fail')::int AS failed,
         ROUND(CASE WHEN COUNT(e.id) FILTER (WHERE e.event_type IN ('parse_success', 'parse_fail')) = 0
           THEN 0
           ELSE (COUNT(e.id) FILTER (WHERE e.event_type = 'parse_success')::numeric / COUNT(e.id) FILTER (WHERE e.event_type IN ('parse_success', 'parse_fail'))::numeric) * 100
         END, 2) AS success_rate
       FROM days d
       LEFT JOIN events e ON e.timestamp::date = d.day
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [start, end],
    ),
    pool.query(
      `SELECT
         COALESCE(subscription_plan, 'unknown') AS plan,
         COUNT(*)::int AS users,
         ROUND((COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM users WHERE ($3::text IS NULL OR subscription_plan = $3)), 0)) * 100, 2) AS user_pct
       FROM users
       WHERE created_at::date <= $2::date
         AND ($3::text IS NULL OR subscription_plan = $3)
       GROUP BY COALESCE(subscription_plan, 'unknown')
       ORDER BY users DESC`,
      [start, end, planFilter],
    ),
    pool.query(
      `WITH signup_weeks AS (
         SELECT id AS user_id, date_trunc('week', created_at)::date AS cohort_week
         FROM users
         WHERE created_at::date BETWEEN $1::date AND $2::date
       ),
       activity_weeks AS (
         SELECT DISTINCT e.user_id, date_trunc('week', e.timestamp)::date AS activity_week
         FROM events e
         WHERE e.user_id IS NOT NULL
           AND e.timestamp::date BETWEEN $1::date AND $2::date + interval '70 days'
       )
       SELECT
         s.cohort_week,
         EXTRACT(week FROM (a.activity_week - s.cohort_week))::int AS week_offset,
         COUNT(DISTINCT s.user_id)::int AS retained_users
       FROM signup_weeks s
       JOIN activity_weeks a ON a.user_id = s.user_id AND a.activity_week >= s.cohort_week
       WHERE EXTRACT(day FROM (a.activity_week - s.cohort_week)) BETWEEN 0 AND 70
       GROUP BY s.cohort_week, week_offset
       ORDER BY s.cohort_week ASC, week_offset ASC`,
      [start, end],
    ),
    pool.query(
      `SELECT
         COALESCE(NULLIF(metadata ->> 'endpoint', ''), event_type) AS endpoint,
         COUNT(*)::int AS hits
       FROM events
       WHERE timestamp::date BETWEEN $1::date AND $2::date
       GROUP BY endpoint
       ORDER BY hits DESC
       LIMIT 15`,
      [start, end],
    ),

    pool.query(
      `SELECT
         COUNT(*)::int AS total_feedback,
         COUNT(*) FILTER (WHERE feedback_type = 'helpful')::int AS helpful_count,
         COUNT(*) FILTER (WHERE feedback_type = 'unhelpful')::int AS unhelpful_count,
         COUNT(*) FILTER (WHERE feedback_type IN ('flag_false_positive', 'flag_missing'))::int AS flagged_count
       FROM candidate_feedback
       WHERE created_at::date BETWEEN $1::date AND $2::date`,
      [start, end],
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
       )
       SELECT
         d.day,
         COUNT(cf.id)::int AS total_feedback,
         COUNT(cf.id) FILTER (WHERE cf.feedback_type = 'helpful')::int AS helpful_count,
         COUNT(cf.id) FILTER (WHERE cf.feedback_type = 'unhelpful')::int AS unhelpful_count,
         COUNT(cf.id) FILTER (WHERE cf.feedback_type = 'flag_false_positive')::int AS false_positive_flags,
         COUNT(cf.id) FILTER (WHERE cf.feedback_type = 'flag_missing')::int AS missing_flags
       FROM days d
       LEFT JOIN candidate_feedback cf ON cf.created_at::date = d.day
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [start, end],
    ),
    pool.query(
      `SELECT
         id,
         user_id,
         candidate_id,
         feedback_type,
         comment,
         sentiment_label,
         sentiment_score,
         created_at
       FROM candidate_feedback
       WHERE created_at::date BETWEEN $1::date AND $2::date
      ORDER BY created_at DESC
      LIMIT 2000`,
      [start, end],
    ),
    pool.query(
      `SELECT
         event_type,
         COUNT(*)::int AS frequency,
         COALESCE(metadata ->> 'route', '/admin/unknown') AS route
       FROM events
       WHERE timestamp::date BETWEEN $1::date AND $2::date
         AND event_type IN ('admin_page_load_failed', 'admin_auth_dropoff', 'admin_filter_used', 'admin_export_clicked', 'admin_page_feedback_submitted')
       GROUP BY event_type, route
       ORDER BY frequency DESC
       LIMIT 20`,
      [start, end],
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'admin_2fa_started')::int AS started,
         COUNT(*) FILTER (WHERE event_type = 'admin_2fa_completed')::int AS completed
       FROM events
       WHERE timestamp::date BETWEEN $1::date AND $2::date`,
      [start, end],
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_useful = true)::int AS useful,
         COUNT(*) FILTER (WHERE is_useful = false)::int AS not_useful
      FROM admin_page_feedback
      WHERE created_at::date BETWEEN $1::date AND $2::date`,
      [start, end],
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(t.total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(t.input_tokens), 0)::bigint AS total_input_tokens,
         COALESCE(SUM(t.output_tokens), 0)::bigint AS total_output_tokens,
         ROUND(COALESCE(AVG(t.total_tokens), 0), 2) AS avg_tokens_per_analysis,
         ROUND(COALESCE(SUM(t.estimated_cost_usd), 0), 6) AS total_estimated_cost_usd,
         ROUND(COALESCE(AVG(t.estimated_cost_usd), 0), 6) AS avg_estimated_cost_usd,
         COUNT(*) FILTER (WHERE t.usage_available = true)::int AS usage_available_count,
         COUNT(*) FILTER (WHERE t.usage_available = false)::int AS usage_unavailable_count
       FROM resume_analysis_token_usage t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.created_at::date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR u.subscription_plan = $3)`,
      [start, end, planFilter],
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
       )
       SELECT
         d.day,
         COALESCE(SUM(t.total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(t.input_tokens), 0)::bigint AS input_tokens,
         COALESCE(SUM(t.output_tokens), 0)::bigint AS output_tokens,
         ROUND(COALESCE(SUM(t.estimated_cost_usd), 0), 6) AS estimated_cost_usd
       FROM days d
       LEFT JOIN resume_analysis_token_usage t ON t.created_at::date = d.day
       LEFT JOIN users u ON u.id = t.user_id
       WHERE ($3::text IS NULL OR u.subscription_plan = $3 OR t.user_id IS NULL)
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [start, end, planFilter],
    ),
    pool.query(
      `SELECT
         t.resume_id,
         r.filename,
         t.user_id,
         u.email AS user_email,
         t.parse_job_id,
         t.provider,
         t.model,
         t.usage_available,
         t.unavailable_reason,
         t.input_tokens,
         t.output_tokens,
         t.total_tokens,
         t.estimated_cost_usd,
         t.created_at
       FROM resume_analysis_token_usage t
       LEFT JOIN resumes r ON r.id = t.resume_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.created_at::date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR u.subscription_plan = $3)
       ORDER BY t.created_at DESC
       LIMIT 500`,
      [start, end, planFilter],
    ),
  ])

    const kpis = kpiResult.rows[0] || {}
    const revenueTrend = revenueTrendResult.rows.map((row) => ({
      month: row.month,
      mrr: Number(row.mrr || 0),
    }))

    const conversion = conversionResult.rows[0] || { signups: 0, verified: 0, paid: 0 }
    const feedbackSummary = feedbackSummaryResult.rows[0] || { total_feedback: 0, helpful_count: 0, unhelpful_count: 0, flagged_count: 0 }
    const uxBlockers = uxBlockersResult.rows || []
    const twoFactorRate = twoFactorRateResult.rows[0] || { started: 0, completed: 0 }
    const adminFeedbackSummary = adminFeedbackSummaryResult.rows[0] || { total: 0, useful: 0, not_useful: 0 }
    const tokenUsageSummary = tokenUsageSummaryResult.rows[0] || {}
    const twoFactorCompletionRate = Number(twoFactorRate.started || 0) === 0
      ? 0
      : Number((((Number(twoFactorRate.completed || 0) / Number(twoFactorRate.started || 0)) * 100).toFixed(2)))

    return {
      filters: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        planType,
      },
      kpis: {
        totalUsers: Number(kpis.total_users || 0),
        mrr: Number(kpis.mrr || 0),
        arr: Number(kpis.arr || 0),
        churnRate: Number(kpis.churn_rate || 0),
        arpu: Number(kpis.arpu || 0),
        parsingSuccessRate: Number(kpis.parsing_success_rate || 0),
        forecastNextMonthMrr: forecastNextMonthMrr(revenueTrend),
        conversionRate: Number(conversion.signups || 0) === 0 ? 0 : Number((((Number(conversion.paid || 0) / Number(conversion.signups || 0)) * 100).toFixed(2))),
        feedbackCount: Number(feedbackSummary.total_feedback || 0),
      },
      revenueTrend,
      userGrowth: growthResult.rows,
      conversionFunnel: conversion,
      parsingTrend: parsingResult.rows,
      planBreakdown: planBreakdownResult.rows,
      retentionCohorts: retentionResult.rows,
      apiUsage: apiUsageResult.rows,
      uxBlockers,
      uxWeeklyReport: {
        dateRange: {
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
        },
        topBlockers: uxBlockers.slice(0, 5),
        twoFactorCompletionRate,
        twoFactorStarted: Number(twoFactorRate.started || 0),
        twoFactorCompleted: Number(twoFactorRate.completed || 0),
        adminFeedbackSummary: {
          total: Number(adminFeedbackSummary.total || 0),
          useful: Number(adminFeedbackSummary.useful || 0),
          notUseful: Number(adminFeedbackSummary.not_useful || 0),
        },
        nextSprintPriorities: buildPriorityRecommendations(uxBlockers),
      },
      feedbackSummary: feedbackSummary,
      feedbackTrend: feedbackTrendResult.rows,
      feedbackExport: feedbackCommentsResult.rows,
      tokenUsageSummary: {
        totalTokens: Number(tokenUsageSummary.total_tokens || 0),
        totalInputTokens: Number(tokenUsageSummary.total_input_tokens || 0),
        totalOutputTokens: Number(tokenUsageSummary.total_output_tokens || 0),
        avgTokensPerAnalysis: Number(tokenUsageSummary.avg_tokens_per_analysis || 0),
        totalEstimatedCostUsd: Number(tokenUsageSummary.total_estimated_cost_usd || 0),
        avgEstimatedCostUsd: Number(tokenUsageSummary.avg_estimated_cost_usd || 0),
        usageAvailableCount: Number(tokenUsageSummary.usage_available_count || 0),
        usageUnavailableCount: Number(tokenUsageSummary.usage_unavailable_count || 0),
      },
      tokenUsageTrend: tokenUsageTrendResult.rows.map((row) => ({
        day: row.day,
        totalTokens: Number(row.total_tokens || 0),
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        estimatedCostUsd: Number(row.estimated_cost_usd || 0),
      })),
      tokenUsageUploads: tokenUsageUploadsResult.rows.map((row) => ({
        resumeId: row.resume_id,
        filename: row.filename,
        userId: row.user_id,
        userEmail: row.user_email,
        parseJobId: row.parse_job_id,
        provider: row.provider,
        model: row.model,
        usageAvailable: row.usage_available === null || row.usage_available === undefined ? null : Boolean(row.usage_available),
        unavailableReason: row.unavailable_reason,
        inputTokens: row.input_tokens === null || row.input_tokens === undefined ? null : Number(row.input_tokens),
        outputTokens: row.output_tokens === null || row.output_tokens === undefined ? null : Number(row.output_tokens),
        totalTokens: row.total_tokens === null || row.total_tokens === undefined ? null : Number(row.total_tokens),
        estimatedCostUsd: row.estimated_cost_usd === null || row.estimated_cost_usd === undefined ? null : Number(row.estimated_cost_usd),
        createdAt: row.created_at,
      })),
      dataMode: {
        limited: false,
        reason: null,
        unavailableSections: [],
        diagnostics: null,
        canRetry: false,
      },
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (isRecoverableAnalyticsSchemaError(error)) {
      console.warn('[AdminAnalytics] Returning fallback analytics due to missing DB relation/column:', error.message)
      return buildFallbackAnalytics({ start, end, planType })
    }

    throw error
  }
}


router.get('/metrics', async (req, res) => {
  try {
    const payload = await loadAnalytics(parseRequestFilters(req))
    return res.json({
      filters: payload.filters,
      kpis: payload.kpis,
      conversionFunnel: payload.conversionFunnel,
      planBreakdown: payload.planBreakdown,
      parsingTrend: payload.parsingTrend,
      tokenUsageSummary: payload.tokenUsageSummary,
      generatedAt: payload.generatedAt,
    })
  } catch (error) {
    console.error('[AdminAnalytics] Failed to load metrics:', error)
    return res.status(500).json({ error: 'Unable to load admin analytics metrics' })
  }
})

router.get('/revenue', async (req, res) => {
  try {
    const payload = await loadAnalytics(parseRequestFilters(req))
    return res.json({
      filters: payload.filters,
      revenueTrend: payload.revenueTrend,
      userGrowth: payload.userGrowth,
      generatedAt: payload.generatedAt,
    })
  } catch (error) {
    console.error('[AdminAnalytics] Failed to load revenue trend:', error)
    return res.status(500).json({ error: 'Unable to load revenue analytics' })
  }
})

router.get('/retention', async (req, res) => {
  try {
    const payload = await loadAnalytics(parseRequestFilters(req))
    return res.json({
      filters: payload.filters,
      retentionCohorts: payload.retentionCohorts,
      generatedAt: payload.generatedAt,
    })
  } catch (error) {
    console.error('[AdminAnalytics] Failed to load retention analytics:', error)
    return res.status(500).json({ error: 'Unable to load retention analytics' })
  }
})

router.get('/token-usage', async (req, res) => {
  try {
    const payload = await loadAnalytics(parseRequestFilters(req))
    return res.json({
      filters: payload.filters,
      tokenUsageSummary: payload.tokenUsageSummary,
      tokenUsageTrend: payload.tokenUsageTrend,
      tokenUsageUploads: payload.tokenUsageUploads,
      generatedAt: payload.generatedAt,
    })
  } catch (error) {
    console.error('[AdminAnalytics] Failed to load token usage analytics:', error)
    return res.status(500).json({ error: 'Unable to load token usage analytics' })
  }
})

router.get('/', async (req, res) => {
  const { startDate, endDate, planType, export: exportType } = req.query
  const range = normalizeDateRange(startDate, endDate)
  const safePlanType = parsePlanType(planType)

  try {
    const payload = await loadAnalytics({ start: range.start, end: range.end, planType: safePlanType })

    if (exportType === 'csv') {
      const csv = toCsv([
        { title: 'kpis', rows: [payload.kpis] },
        { title: 'revenue_trend', rows: payload.revenueTrend },
        { title: 'user_growth', rows: payload.userGrowth },
        { title: 'conversion_funnel', rows: [payload.conversionFunnel] },
        { title: 'parsing_trend', rows: payload.parsingTrend },
        { title: 'plan_breakdown', rows: payload.planBreakdown },
        { title: 'retention_cohorts', rows: payload.retentionCohorts },
        { title: 'api_usage', rows: payload.apiUsage },
        { title: 'feedback_summary', rows: [payload.feedbackSummary] },
        { title: 'feedback_trend', rows: payload.feedbackTrend },
        { title: 'feedback_export', rows: payload.feedbackExport },
        { title: 'token_usage_summary', rows: [payload.tokenUsageSummary] },
        { title: 'token_usage_trend', rows: payload.tokenUsageTrend },
        { title: 'token_usage_uploads', rows: payload.tokenUsageUploads },
      ])

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="analytics-${payload.filters.startDate}-to-${payload.filters.endDate}.csv"`)
      return res.status(200).send(csv)
    }

    return res.json(payload)
  } catch (error) {
    console.error('[AdminAnalytics] Failed to load analytics dashboard data:', error)
    return res.status(500).json({ error: 'Unable to load admin analytics' })
  }
})

export default router
