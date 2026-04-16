import { pool, logErrorToDatabase } from '../db/client.js'

const ALLOWED_EVENTS = new Set([
  'signup',
  'email_verified',
  'login',
  'upload_start',
  'upload_complete',
  'parse_success',
  'parse_fail',
  'checkout_start',
  'checkout_complete',
  'payment_success',
  'payment_fail',
  'cancellation',
  'feedback_submitted',
  'admin_page_load_failed',
  'admin_filter_used',
  'admin_export_clicked',
  'admin_auth_dropoff',
  'admin_2fa_started',
  'admin_2fa_completed',
  'admin_page_feedback_submitted',
])

const PII_FIELD_PATTERN = /(email|phone|name|ip|address|password|token)/i

function sanitizeMetadata(input, depth = 0) {
  if (!input || typeof input !== 'object' || depth > 3) {
    return {}
  }

  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item) => (typeof item === 'object' ? sanitizeMetadata(item, depth + 1) : item))
  }

  return Object.entries(input).reduce((acc, [key, value]) => {
    if (PII_FIELD_PATTERN.test(key)) {
      return acc
    }

    if (typeof value === 'string' && value.length > 300) {
      acc[key] = value.slice(0, 300)
      return acc
    }

    if (value && typeof value === 'object') {
      acc[key] = sanitizeMetadata(value, depth + 1)
      return acc
    }

    acc[key] = value
    return acc
  }, {})
}

export async function trackEvent({ userId = null, eventType, metadata = {}, occurredAt = new Date() }) {
  if (!ALLOWED_EVENTS.has(eventType)) {
    return
  }

  const sanitizedMetadata = sanitizeMetadata(metadata)

  try {
    await pool.query(
      `INSERT INTO events (user_id, event_type, timestamp, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, eventType, occurredAt, JSON.stringify(sanitizedMetadata)],
    )
  } catch (error) {
    console.error('[Analytics] Failed to track event', { eventType, userId, error: error.message })
    await logErrorToDatabase('analytics.track_event_failed', error, { eventType, userId })
  }
}

export async function computeDailyMetrics(targetDate = new Date()) {
  const day = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()))

  const metricsQuery = `
    WITH day_window AS (
      SELECT $1::date AS metric_date,
             $1::timestamptz AS day_start,
             ($1::timestamptz + interval '1 day') AS day_end
    ),
    daily_active AS (
      SELECT COUNT(DISTINCT e.user_id)::int AS value
      FROM events e
      CROSS JOIN day_window d
      WHERE e.user_id IS NOT NULL
        AND e.timestamp >= d.day_start
        AND e.timestamp < d.day_end
    ),
    weekly_active AS (
      SELECT COUNT(DISTINCT e.user_id)::int AS value
      FROM events e
      CROSS JOIN day_window d
      WHERE e.user_id IS NOT NULL
        AND e.timestamp >= d.day_end - interval '7 days'
        AND e.timestamp < d.day_end
    ),
    monthly_active AS (
      SELECT COUNT(DISTINCT e.user_id)::int AS value
      FROM events e
      CROSS JOIN day_window d
      WHERE e.user_id IS NOT NULL
        AND e.timestamp >= d.day_end - interval '30 days'
        AND e.timestamp < d.day_end
    ),
    signup_to_payment AS (
      SELECT
        COUNT(*) FILTER (WHERE first_signup IS NOT NULL)::numeric AS signup_count,
        COUNT(*) FILTER (WHERE first_signup IS NOT NULL AND first_payment IS NOT NULL AND first_payment >= first_signup)::numeric AS paid_count
      FROM (
        SELECT user_id,
               MIN(CASE WHEN event_type = 'signup' THEN timestamp END) AS first_signup,
               MIN(CASE WHEN event_type = 'payment_success' THEN timestamp END) AS first_payment
        FROM events
        GROUP BY user_id
      ) funnel
    ),
    parse_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'parse_success')::numeric AS success_count,
        COUNT(*) FILTER (WHERE event_type IN ('parse_success','parse_fail'))::numeric AS total_count
      FROM events e
      CROSS JOIN day_window d
      WHERE e.timestamp >= d.day_start
        AND e.timestamp < d.day_end
    ),
    churn AS (
      SELECT
        COALESCE((
          SELECT COUNT(*)::numeric
          FROM events e
          CROSS JOIN day_window d
          WHERE e.event_type = 'cancellation'
            AND e.timestamp >= date_trunc('month', d.day_start)
            AND e.timestamp < date_trunc('month', d.day_start) + interval '1 month'
        ), 0) AS cancelled_count,
        COALESCE((
          SELECT COUNT(*)::numeric
          FROM users u
          CROSS JOIN day_window d
          WHERE u.subscription_started_at < date_trunc('month', d.day_start)
            AND COALESCE(u.subscription_status, 'inactive') IN ('active', 'trialing')
        ), 0) AS active_start_count
    ),
    monthly_revenue AS (
      SELECT
        COALESCE(SUM((e.metadata ->> 'amount')::numeric), 0) AS total_revenue,
        COUNT(DISTINCT e.user_id)::numeric AS paying_users
      FROM events e
      CROSS JOIN day_window d
      WHERE e.event_type = 'payment_success'
        AND e.timestamp >= date_trunc('month', d.day_start)
        AND e.timestamp < date_trunc('month', d.day_start) + interval '1 month'
    )
    SELECT
      d.metric_date,
      da.value AS dau,
      wa.value AS wau,
      ma.value AS mau,
      CASE WHEN f.signup_count = 0 THEN 0 ELSE ROUND((f.paid_count / f.signup_count) * 100, 2) END AS conversion_rate,
      CASE WHEN c.active_start_count = 0 THEN 0 ELSE ROUND((c.cancelled_count / c.active_start_count) * 100, 2) END AS churn_rate,
      CASE WHEN mr.paying_users = 0 THEN 0 ELSE ROUND(mr.total_revenue / mr.paying_users, 2) END AS arpu,
      CASE WHEN ps.total_count = 0 THEN 0 ELSE ROUND((ps.success_count / ps.total_count) * 100, 2) END AS parsing_success_rate,
      ROUND(mr.total_revenue, 2) AS mrr,
      ROUND(mr.total_revenue * 12, 2) AS arr
    FROM day_window d
    CROSS JOIN daily_active da
    CROSS JOIN weekly_active wa
    CROSS JOIN monthly_active ma
    CROSS JOIN signup_to_payment f
    CROSS JOIN parse_stats ps
    CROSS JOIN churn c
    CROSS JOIN monthly_revenue mr
  `

  const revenueByPlanQuery = `
    WITH month_window AS (
      SELECT date_trunc('month', $1::date)::timestamptz AS month_start,
             (date_trunc('month', $1::date) + interval '1 month')::timestamptz AS month_end
    )
    SELECT
      COALESCE(NULLIF(e.metadata ->> 'plan', ''), 'unknown') AS plan_type,
      ROUND(COALESCE(SUM((e.metadata ->> 'amount')::numeric), 0), 2) AS revenue,
      COUNT(DISTINCT e.user_id)::int AS paying_users,
      CASE WHEN COUNT(DISTINCT e.user_id) = 0 THEN 0
           ELSE ROUND(COALESCE(SUM((e.metadata ->> 'amount')::numeric), 0) / COUNT(DISTINCT e.user_id), 2)
      END AS arpu
    FROM events e
    CROSS JOIN month_window mw
    WHERE e.event_type = 'payment_success'
      AND e.timestamp >= mw.month_start
      AND e.timestamp < mw.month_end
    GROUP BY 1
  `

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const metricsResult = await client.query(metricsQuery, [day])
    const metrics = metricsResult.rows[0]

    await client.query(
      `INSERT INTO analytics_daily (
         metric_date, dau, wau, mau, conversion_rate, churn_rate, arpu,
         parsing_success_rate, mrr, arr, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (metric_date)
       DO UPDATE SET dau = EXCLUDED.dau,
                     wau = EXCLUDED.wau,
                     mau = EXCLUDED.mau,
                     conversion_rate = EXCLUDED.conversion_rate,
                     churn_rate = EXCLUDED.churn_rate,
                     arpu = EXCLUDED.arpu,
                     parsing_success_rate = EXCLUDED.parsing_success_rate,
                     mrr = EXCLUDED.mrr,
                     arr = EXCLUDED.arr,
                     updated_at = NOW()`,
      [
        metrics.metric_date,
        metrics.dau,
        metrics.wau,
        metrics.mau,
        metrics.conversion_rate,
        metrics.churn_rate,
        metrics.arpu,
        metrics.parsing_success_rate,
        metrics.mrr,
        metrics.arr,
      ],
    )

    const planResult = await client.query(revenueByPlanQuery, [day])

    await client.query('DELETE FROM analytics_revenue_by_plan WHERE metric_month = date_trunc(\'month\', $1::date)', [day])

    for (const row of planResult.rows) {
      await client.query(
        `INSERT INTO analytics_revenue_by_plan (metric_month, plan_type, revenue, paying_users, arpu, updated_at)
         VALUES (date_trunc('month', $1::date), $2, $3, $4, $5, NOW())`,
        [day, row.plan_type, row.revenue, row.paying_users, row.arpu],
      )
    }

    await client.query('COMMIT')
    return metrics
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Analytics] Failed to compute daily metrics:', error)
    await logErrorToDatabase('analytics.compute_daily_failed', error)
    throw error
  } finally {
    client.release()
  }
}

export async function getAnalyticsSummary(days = 30) {
  const safeDays = Math.min(Math.max(Number(days) || 30, 7), 120)

  const [trendResult, latestResult, planResult] = await Promise.all([
    pool.query(
      `SELECT metric_date, dau, wau, mau, conversion_rate, churn_rate, parsing_success_rate, arpu, mrr, arr
       FROM analytics_daily
       WHERE metric_date >= CURRENT_DATE - ($1::int - 1)
       ORDER BY metric_date ASC`,
      [safeDays],
    ),
    pool.query(
      `SELECT metric_date, dau, wau, mau, conversion_rate, churn_rate, parsing_success_rate, arpu, mrr, arr
       FROM analytics_daily
       ORDER BY metric_date DESC
       LIMIT 1`,
    ),
    pool.query(
      `SELECT metric_month, plan_type, revenue, paying_users, arpu
       FROM analytics_revenue_by_plan
       WHERE metric_month >= date_trunc('month', CURRENT_DATE - interval '5 months')
       ORDER BY metric_month ASC, plan_type ASC`,
    ),
  ])

  return {
    latest: latestResult.rows[0] || null,
    trends: trendResult.rows,
    revenueByPlan: planResult.rows,
  }
}


const POSITIVE_TOKENS = ['great', 'good', 'helpful', 'accurate', 'strong', 'excellent', 'clear', 'relevant']
const NEGATIVE_TOKENS = ['bad', 'poor', 'wrong', 'unhelpful', 'inaccurate', 'missing', 'irrelevant', 'false']

export function analyzeCommentSentiment(comment) {
  if (!comment || typeof comment !== 'string') {
    return { label: 'neutral', score: 0 }
  }

  const words = comment.toLowerCase().match(/[a-z']+/g) || []
  let score = 0

  for (const word of words) {
    if (POSITIVE_TOKENS.includes(word)) score += 1
    if (NEGATIVE_TOKENS.includes(word)) score -= 1
  }

  if (score > 0) return { label: 'positive', score }
  if (score < 0) return { label: 'negative', score }
  return { label: 'neutral', score: 0 }
}

export async function trackFeedbackSubmitted({ userId, candidateId, feedbackType, comment, sentimentLabel, sentimentScore }) {
  await trackEvent({
    userId,
    eventType: 'feedback_submitted',
    metadata: {
      candidateId,
      feedbackType,
      hasComment: Boolean(comment),
      sentimentLabel,
      sentimentScore,
    },
  })
}

export function startAnalyticsCron() {
  const CRON_INTERVAL_MS = 24 * 60 * 60 * 1000

  const run = async () => {
    try {
      await computeDailyMetrics(new Date())
      console.log('[Analytics] Daily metrics computed successfully')
    } catch (error) {
      console.error('[Analytics] Cron failed:', error)
    }
  }

  setInterval(run, CRON_INTERVAL_MS)
  void run()
  console.log('[Analytics] Cron job scheduled (every 24 hours)')
}
