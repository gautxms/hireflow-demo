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


function parseRequestFilters(req) {
  const { startDate, endDate, planType } = req.query
  const range = normalizeDateRange(startDate, endDate)
  const safePlanType = parsePlanType(planType)
  return { start: range.start, end: range.end, planType: safePlanType }
}

async function loadAnalytics({ start, end, planType }) {
  const planFilter = planType === 'all' ? null : planType

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
  ])

  const kpis = kpiResult.rows[0] || {}
  const revenueTrend = revenueTrendResult.rows.map((row) => ({
    month: row.month,
    mrr: Number(row.mrr || 0),
  }))

  const conversion = conversionResult.rows[0] || { signups: 0, verified: 0, paid: 0 }
  const feedbackSummary = feedbackSummaryResult.rows[0] || { total_feedback: 0, helpful_count: 0, unhelpful_count: 0, flagged_count: 0 }

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
    feedbackSummary: feedbackSummary,
    feedbackTrend: feedbackTrendResult.rows,
    feedbackExport: feedbackCommentsResult.rows,
    generatedAt: new Date().toISOString(),
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
