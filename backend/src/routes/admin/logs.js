import { Router } from 'express'
import { pool } from '../../db/client.js'

const router = Router()
const SENSITIVE_KEY_PATTERN = /(password|token|secret|authorization|cookie|resume|raw|text|email|phone|ssn)/i
const REDACTED = '[REDACTED]'

function toIsoDate(value, fallback) {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toISOString()
}

function toInt(value, fallback, { min = 1, max = 200 } = {}) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function redactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, REDACTED]
        }
        return [key, redactValue(entry)]
      }),
    )
  }

  if (typeof value === 'string') {
    const withEmailRedacted = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, REDACTED)
    return withEmailRedacted.length > 1000 ? `${withEmailRedacted.slice(0, 1000)}…` : withEmailRedacted
  }

  return value
}

async function listErrorLogs(req, res) {
  const page = toInt(req.query.page, 1)
  const pageSize = toInt(req.query.pageSize, 20, { min: 5, max: 100 })
  const offset = (page - 1) * pageSize

  const endDate = toIsoDate(req.query.endDate, new Date().toISOString())
  const startDate = toIsoDate(
    req.query.startDate,
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  )

  const search = String(req.query.search || '').trim()
  const endpoint = String(req.query.endpoint || '').trim()
  const statusCode = String(req.query.statusCode || '').trim()

  try {
    const result = await pool.query(
      `WITH filtered AS (
         SELECT
           el.id,
           el.source,
           el.message,
           el.stack,
           el.context,
           el.created_at,
           COALESCE(NULLIF(el.context ->> 'endpoint', ''), NULLIF(el.context ->> 'path', ''), 'n/a') AS endpoint,
           COALESCE(NULLIF(el.context ->> 'statusCode', ''), 'n/a') AS status_code,
           COALESCE((el.context ->> 'resolved')::boolean, false) AS resolved,
           COUNT(DISTINCT NULLIF(el.context ->> 'userId', '')) OVER (
             PARTITION BY el.message,
             COALESCE(NULLIF(el.context ->> 'endpoint', ''), NULLIF(el.context ->> 'path', ''), 'n/a'),
             COALESCE(NULLIF(el.context ->> 'statusCode', ''), 'n/a')
           ) AS affected_users,
           COUNT(*) OVER () AS total_count
         FROM error_logs el
         WHERE el.created_at BETWEEN $1::timestamptz AND $2::timestamptz
           AND ($3 = '' OR el.message ILIKE '%' || $3 || '%')
           AND ($4 = '' OR COALESCE(NULLIF(el.context ->> 'endpoint', ''), NULLIF(el.context ->> 'path', ''), '') = $4)
           AND ($5 = '' OR COALESCE(NULLIF(el.context ->> 'statusCode', ''), '') = $5)
       )
       SELECT *
       FROM filtered
       ORDER BY created_at DESC
       LIMIT $6 OFFSET $7`,
      [startDate, endDate, search, endpoint, statusCode, pageSize, offset],
    )

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0
    return res.json({
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize) || 1,
      retentionDays: 30,
      items: result.rows.map((row) => ({
        id: row.id,
        source: row.source,
        message: redactValue(row.message),
        stack: redactValue(row.stack),
        context: redactValue(row.context || {}),
        endpoint: row.endpoint,
        statusCode: row.status_code,
        resolved: row.resolved,
        affectedUsers: Number(row.affected_users || 0),
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    console.error('[Admin logs] failed to fetch errors', error)
    return res.status(500).json({ error: 'Failed to fetch error logs' })
  }
}

router.get('/', listErrorLogs)
router.get('/errors', listErrorLogs)

router.get('/errors/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, source, message, stack, context, created_at
       FROM error_logs
       WHERE id = $1`,
      [req.params.id],
    )

    const entry = result.rows[0]
    if (!entry) {
      return res.status(404).json({ error: 'Error log not found' })
    }

    return res.json({
      id: entry.id,
      source: entry.source,
      message: redactValue(entry.message),
      stack: redactValue(entry.stack),
      context: redactValue(entry.context || {}),
      createdAt: entry.created_at,
    })
  } catch (error) {
    console.error('[Admin logs] failed to fetch error details', error)
    return res.status(500).json({ error: 'Failed to fetch error details' })
  }
})

router.patch('/errors/:id/resolve', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE error_logs
       SET context = COALESCE(context, '{}'::jsonb) || jsonb_build_object(
         'resolved', true,
         'resolvedAt', NOW(),
         'resolvedBy', COALESCE($2::text, 'admin')
       )
       WHERE id = $1
       RETURNING id, context`,
      [req.params.id, req.body?.resolvedBy || null],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Error log not found' })
    }

    return res.json({ ok: true, id: result.rows[0].id, context: result.rows[0].context })
  } catch (error) {
    console.error('[Admin logs] failed to resolve error', error)
    return res.status(500).json({ error: 'Failed to mark error resolved' })
  }
})

router.get('/webhooks', async (req, res) => {
  const page = toInt(req.query.page, 1)
  const pageSize = toInt(req.query.pageSize, 25, { min: 5, max: 100 })
  const offset = (page - 1) * pageSize

  try {
    const result = await pool.query(
      `WITH audit AS (
         SELECT
           id,
           event_type,
           payload,
           signature_valid,
           error_message,
           created_at,
           CASE
             WHEN error_message IS NOT NULL OR signature_valid = false THEN 'failed'
             WHEN payload ? 'retry_at' OR payload ? 'next_retry_at' THEN 'pending_retry'
             ELSE 'processed'
           END AS status,
           COUNT(*) OVER () AS total_count
         FROM paddle_webhook_audit
       )
       SELECT *
       FROM audit
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    )

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0
    return res.json({
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize) || 1,
      items: result.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        status: row.status,
        requestBody: redactValue(row.payload),
        responseBody: {
          signatureValid: row.signature_valid,
          errorMessage: redactValue(row.error_message),
        },
        timestamp: row.created_at,
      })),
    })
  } catch (error) {
    console.error('[Admin logs] failed to fetch webhook audit', error)
    return res.status(500).json({ error: 'Failed to fetch webhook audit' })
  }
})

export default router
