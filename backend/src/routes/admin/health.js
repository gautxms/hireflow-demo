import os from 'os'
import { Router } from 'express'
import { pool } from '../../db/client.js'

const router = Router()

const SERVER_BOOT_TIME = Date.now()

function memorySnapshot() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const percent = total > 0 ? Number(((used / total) * 100).toFixed(2)) : 0

  return {
    used,
    free,
    total,
    usagePercent: percent,
    trend: {
      rss: globalThis.process.memoryUsage().rss,
      heapUsed: globalThis.process.memoryUsage().heapUsed,
      heapTotal: globalThis.process.memoryUsage().heapTotal,
    },
  }
}

function cpuSnapshot() {
  const load = os.loadavg()
  const cores = os.cpus().length || 1
  const normalized = Number(((load[0] / cores) * 100).toFixed(2))
  return {
    load1m: load[0],
    load5m: load[1],
    load15m: load[2],
    cores,
    usagePercent: normalized,
  }
}

function statusFromSignals({ dbOk, memoryPercent, cpuPercent }) {
  if (!dbOk || memoryPercent >= 90 || cpuPercent >= 90) {
    return 'red'
  }

  if (memoryPercent >= 80 || cpuPercent >= 80) {
    return 'yellow'
  }

  return 'green'
}

export function normalizeQueueCounts(row = {}) {
  return {
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    failed: Number(row.failed || 0),
    succeeded: Number(row.succeeded || 0),
  }
}

router.get('/', async (_req, res) => {
  const startedAt = Date.now()
  let db = {
    connected: false,
    latencyMs: null,
    avgQueryMs: null,
    activeConnections: 0,
  }

  try {
    const pingStart = Date.now()
    await pool.query('SELECT 1')

    const [connResult, queryPerfResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS active_connections FROM pg_stat_activity WHERE state = 'active'`),
      pool.query(
        `SELECT ROUND(AVG((metadata ->> 'responseMs')::numeric), 2) AS avg_query_ms
         FROM events
         WHERE event_type = 'api.response'
           AND timestamp >= NOW() - interval '15 minutes'
           AND (metadata ->> 'responseMs') ~ '^[0-9]+(\\.[0-9]+)?$'`,
      ),
    ])

    db = {
      connected: true,
      latencyMs: Date.now() - pingStart,
      avgQueryMs: Number(queryPerfResult.rows[0]?.avg_query_ms || 0),
      activeConnections: Number(connResult.rows[0]?.active_connections || 0),
    }
  } catch (error) {
    db = { ...db, error: error.message }
  }

  const memory = memorySnapshot()
  const cpu = cpuSnapshot()

  const [apiResult, webhookSummaryResult, jobSummaryResult, jobTypeResult, failedJobsResult] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(metadata ->> 'endpoint', event_type) AS endpoint,
         COUNT(*)::int AS hits,
         ROUND(AVG((metadata ->> 'responseMs')::numeric), 2) AS avg_response_ms,
         MAX(timestamp) AS last_seen_at
       FROM events
       WHERE timestamp >= NOW() - interval '30 minutes'
         AND (metadata ->> 'responseMs') ~ '^[0-9]+(\\.[0-9]+)?$'
       GROUP BY endpoint
       ORDER BY hits DESC
       LIMIT 20`,
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE error_message IS NOT NULL OR signature_valid = false)::int AS failed,
         COUNT(*) FILTER (WHERE error_message IS NULL AND signature_valid = true)::int AS processed,
         MAX(created_at) AS latest_event_at
       FROM paddle_webhook_audit
       WHERE created_at >= NOW() - interval '30 days'`,
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status IN ('processing', 'retrying'))::int AS processing,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'complete')::int AS succeeded
       FROM parse_jobs
       WHERE created_at >= NOW() - interval '30 days'`,
    ),
    pool.query(
      `SELECT
         'resume_parse' AS job_type,
         ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000), 2) AS avg_processing_ms,
         COUNT(*)::int AS total
       FROM parse_jobs
       WHERE status = 'complete'
       GROUP BY job_type
       ORDER BY total DESC`,
    ),
    pool.query(
      `SELECT job_id AS id, resume_id, status, attempts AS retry_count, error_message AS last_error, updated_at
       FROM parse_jobs
       WHERE status = 'failed'
       ORDER BY updated_at DESC
       LIMIT 25`,
    ),
  ])

  const alerts = []
  if (!db.connected) {
    alerts.push({ severity: 'critical', message: 'Database connection is down.' })
  }
  if (memory.usagePercent >= 90) {
    alerts.push({ severity: 'critical', message: `Memory usage is critical at ${memory.usagePercent}%.` })
  } else if (memory.usagePercent >= 80) {
    alerts.push({ severity: 'warning', message: `Memory usage is elevated at ${memory.usagePercent}%.` })
  }

  return res.json({
    generatedAt: new Date().toISOString(),
    refreshHintMs: 15000,
    retentionDays: 30,
    systemStatus: statusFromSignals({
      dbOk: db.connected,
      memoryPercent: memory.usagePercent,
      cpuPercent: cpu.usagePercent,
    }),
    uptime: {
      seconds: Math.floor(globalThis.process.uptime()),
      since: new Date(SERVER_BOOT_TIME).toISOString(),
    },
    db,
    memory,
    cpu,
    apiHealth: apiResult.rows.map((row) => ({
      endpoint: row.endpoint,
      hits: Number(row.hits || 0),
      avgResponseMs: Number(row.avg_response_ms || 0),
      lastSeenAt: row.last_seen_at,
    })),
    webhookAudit: {
      total: Number(webhookSummaryResult.rows[0]?.total || 0),
      failed: Number(webhookSummaryResult.rows[0]?.failed || 0),
      processed: Number(webhookSummaryResult.rows[0]?.processed || 0),
      latestEventAt: webhookSummaryResult.rows[0]?.latest_event_at || null,
    },
    jobQueue: {
      counts: {
        ...normalizeQueueCounts(jobSummaryResult.rows[0]),
      },
      avgProcessingTimeByType: jobTypeResult.rows.map((row) => ({
        jobType: row.job_type,
        avgProcessingMs: Number(row.avg_processing_ms || 0),
        total: Number(row.total || 0),
      })),
      failedJobs: failedJobsResult.rows,
    },
    alerts,
    requestDurationMs: Date.now() - startedAt,
  })
})


router.get('/queue', async (_req, res) => {
  try {
    const [jobSummaryResult, jobTypeResult, failedJobsResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
           COUNT(*) FILTER (WHERE status IN ('processing', 'retrying'))::int AS processing,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'complete')::int AS succeeded
         FROM parse_jobs
         WHERE created_at >= NOW() - interval '30 days'`,
      ),
      pool.query(
        `SELECT
           'resume_parse' AS job_type,
           ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000), 2) AS avg_processing_ms,
           COUNT(*)::int AS total
         FROM parse_jobs
         WHERE status = 'complete'
         GROUP BY job_type
         ORDER BY total DESC`,
      ),
      pool.query(
        `SELECT job_id AS id, resume_id, status, attempts AS retry_count, error_message AS last_error, updated_at
         FROM parse_jobs
         WHERE status = 'failed'
         ORDER BY updated_at DESC
         LIMIT 25`,
      ),
    ])

    return res.json({
      counts: {
        ...normalizeQueueCounts(jobSummaryResult.rows[0]),
      },
      avgProcessingTimeByType: jobTypeResult.rows.map((row) => ({
        jobType: row.job_type,
        avgProcessingMs: Number(row.avg_processing_ms || 0),
        total: Number(row.total || 0),
      })),
      failedJobs: failedJobsResult.rows,
    })
  } catch (error) {
    console.error('[Admin health] queue health failed', error)
    return res.status(500).json({ error: 'Failed to fetch queue health' })
  }
})

router.get('/database', async (_req, res) => {
  try {
    const pingStart = Date.now()
    await pool.query('SELECT 1')

    const [connResult, queryPerfResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS active_connections FROM pg_stat_activity WHERE state = 'active'`),
      pool.query(
        `SELECT ROUND(AVG((metadata ->> 'responseMs')::numeric), 2) AS avg_query_ms
         FROM events
         WHERE event_type = 'api.response'
           AND timestamp >= NOW() - interval '15 minutes'
           AND (metadata ->> 'responseMs') ~ '^[0-9]+(\.[0-9]+)?$'`,
      ),
    ])

    return res.json({
      connected: true,
      latencyMs: Date.now() - pingStart,
      avgQueryMs: Number(queryPerfResult.rows[0]?.avg_query_ms || 0),
      activeConnections: Number(connResult.rows[0]?.active_connections || 0),
    })
  } catch (error) {
    return res.status(500).json({
      connected: false,
      error: error.message,
      latencyMs: null,
      avgQueryMs: null,
      activeConnections: 0,
    })
  }
})

router.post('/jobs/:id/retry', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE payment_attempts
       SET status = 'failed',
           next_retry_at = NOW(),
           updated_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || '{"retryRequestedBy":"admin"}'::jsonb
       WHERE id = $1
       RETURNING id, status, next_retry_at`,
      [req.params.id],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Job not found' })
    }

    return res.json({ ok: true, job: result.rows[0] })
  } catch (error) {
    console.error('[Admin health] failed to retry job', error)
    return res.status(500).json({ error: 'Failed to retry job' })
  }
})


router.get('/claude-usage', async (_req, res) => {
  try {
    const { getClaudeTokenStats } = await import('../../services/aiResumeAnalysisService.js')
    const stats = getClaudeTokenStats()

    const inputCost = (Number(stats.input || 0) / 1000) * 0.003
    const outputCost = (Number(stats.output || 0) / 1000) * 0.015
    const totalCost = inputCost + outputCost

    return res.json({
      service: 'claude-api',
      status: process.env.ANTHROPIC_API_KEY ? 'enabled' : 'disabled',
      tokens: {
        input: Number(stats.input || 0),
        output: Number(stats.output || 0),
        totalRequests: Number(stats.totalRequests || 0),
      },
      cost: {
        input: `$${inputCost.toFixed(4)}`,
        output: `$${outputCost.toFixed(4)}`,
        total: `$${totalCost.toFixed(4)}`,
      },
    })
  } catch (error) {
    console.error('[Admin health] Claude usage failed', error)
    return res.status(500).json({ error: 'Failed to fetch Claude usage stats' })
  }
})

export default router
