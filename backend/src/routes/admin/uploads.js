import { Router } from 'express'
import { pool } from '../../db/client.js'
import { parseQueue } from '../../services/jobQueue.js'

const router = Router()
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const SUSPICIOUS_SIZE_BYTES = 15 * 1024 * 1024

function toIso(value) {
  if (!value) return null
  return new Date(value).toISOString()
}

function normalizeStatus(row) {
  if (row.parse_status) return row.parse_status
  if (row.raw_text && String(row.raw_text).trim()) return 'complete'
  if (row.parse_error) return 'failed'
  return 'pending'
}

function normalizeFileType(row) {
  if (row.file_type) return row.file_type
  const fileName = String(row.filename || '').toLowerCase()
  if (fileName.endsWith('.pdf')) return 'application/pdf'
  if (fileName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'unknown'
}

function getFormatLabel(fileType) {
  if (fileType === 'application/pdf') return 'PDF'
  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX'
  return 'OTHER'
}

function classifyFailure(errorText = '') {
  const error = String(errorText || '').toLowerCase()

  if (!error) return 'unknown'
  if (error.includes('timeout')) return 'timeout'
  if (error.includes('unsupported')) return 'unsupported_format'
  if (error.includes('corrupt')) return 'corrupt_file'
  if (error.includes('empty')) return 'empty_text'

  return 'other'
}

function mapUploadRow(row) {
  const status = normalizeStatus(row)
  const fileType = normalizeFileType(row)
  const fileSize = Number(row.file_size || 0)
  const suspiciousReasons = []

  if (fileSize > SUSPICIOUS_SIZE_BYTES) {
    suspiciousReasons.push('oversized')
  }

  if (getFormatLabel(fileType) === 'OTHER') {
    suspiciousReasons.push('unusual_format')
  }

  return {
    id: row.id,
    filename: row.filename,
    userId: row.user_id,
    userEmail: row.user_email || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    fileType,
    format: getFormatLabel(fileType),
    fileSize,
    parseStatus: status,
    parseDurationMs: Number(row.parse_duration_ms || 0),
    parseResult: row.parse_result || null,
    parseError: row.parse_error || null,
    rawText: row.raw_text || '',
    suspicious: suspiciousReasons.length > 0,
    suspiciousReasons,
    tokenUsage: {
      usageAvailable: row.usage_available === null || row.usage_available === undefined ? null : Boolean(row.usage_available),
      unavailableReason: row.unavailable_reason || null,
      provider: row.token_provider || null,
      model: row.token_model || null,
      inputTokens: row.input_tokens === null || row.input_tokens === undefined ? null : Number(row.input_tokens),
      outputTokens: row.output_tokens === null || row.output_tokens === undefined ? null : Number(row.output_tokens),
      totalTokens: row.total_tokens === null || row.total_tokens === undefined ? null : Number(row.total_tokens),
      estimatedCostUsd: row.estimated_cost_usd === null || row.estimated_cost_usd === undefined ? null : Number(row.estimated_cost_usd),
      capturedAt: toIso(row.token_captured_at),
    },
  }
}

async function ensureUploadMonitoringColumns() {
  await pool.query(`
    ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS file_size BIGINT,
    ADD COLUMN IF NOT EXISTS file_type TEXT,
    ADD COLUMN IF NOT EXISTS parse_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS parse_result JSONB,
    ADD COLUMN IF NOT EXISTS parse_error TEXT,
    ADD COLUMN IF NOT EXISTS parse_duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS retried_at TIMESTAMP;
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_analysis_token_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      parse_job_id TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      job_description_id UUID,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      model TEXT,
      usage_available BOOLEAN NOT NULL DEFAULT false,
      unavailable_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost_usd NUMERIC(12, 6),
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)
}

router.get('/', async (req, res) => {
  const {
    status = 'all',
    startDate,
    endDate,
    search,
    page = '1',
    pageSize = String(DEFAULT_PAGE_SIZE),
  } = req.query

  const normalizedPage = Math.max(Number.parseInt(page, 10) || 1, 1)
  const normalizedPageSize = Math.min(Math.max(Number.parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

  const where = []
  const params = []

  if (status && status !== 'all') {
    params.push(status)
    where.push(`COALESCE(r.parse_status, CASE WHEN COALESCE(r.raw_text, '') <> '' THEN 'complete' ELSE 'pending' END) = $${params.length}`)
  }

  if (startDate) {
    params.push(startDate)
    where.push(`r.created_at >= $${params.length}::timestamp`)
  }

  if (endDate) {
    params.push(endDate)
    where.push(`r.created_at <= $${params.length}::timestamp + INTERVAL '1 day'`)
  }

  if (search) {
    params.push(`%${search.trim()}%`)
    where.push(`r.filename ILIKE $${params.length}`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    await ensureUploadMonitoringColumns()

    const countResult = await pool.query(
      `SELECT COUNT(*)::INT AS count
       FROM resumes r
       ${whereClause}`,
      params,
    )

    const total = Number(countResult.rows[0]?.count || 0)
    const totalPages = Math.max(Math.ceil(total / normalizedPageSize), 1)
    const offset = (normalizedPage - 1) * normalizedPageSize

    const listParams = [...params, normalizedPageSize, offset]
    const rowsResult = await pool.query(
      `SELECT r.id,
              r.user_id,
              u.email AS user_email,
              r.filename,
              r.raw_text,
              r.file_size,
              r.file_type,
              r.parse_status,
              r.parse_result,
              r.parse_error,
              r.parse_duration_ms,
              r.created_at,
              r.updated_at,
              token.usage_available,
              token.unavailable_reason,
              token.provider AS token_provider,
              token.model AS token_model,
              token.input_tokens,
              token.output_tokens,
              token.total_tokens,
              token.estimated_cost_usd,
              token.created_at AS token_captured_at
       FROM resumes r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT *
         FROM resume_analysis_token_usage t
         WHERE t.resume_id = r.id
         ORDER BY t.created_at DESC
         LIMIT 1
       ) token ON true
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    )

    return res.json({
      uploads: rowsResult.rows.map(mapUploadRow),
      pagination: {
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total,
        totalPages,
      },
    })
  } catch (error) {
    console.error('[Admin uploads] list failed:', error)
    return res.status(500).json({ error: 'Unable to load uploads' })
  }
})

router.get('/stats', async (req, res) => {
  const { startDate, endDate } = req.query

  const where = []
  const params = []

  if (startDate) {
    params.push(startDate)
    where.push(`r.created_at >= $${params.length}::timestamp`)
  }

  if (endDate) {
    params.push(endDate)
    where.push(`r.created_at <= $${params.length}::timestamp + INTERVAL '1 day'`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    await ensureUploadMonitoringColumns()

    const summaryResult = await pool.query(
      `SELECT
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (
          WHERE COALESCE(parse_status, CASE WHEN COALESCE(raw_text, '') <> '' THEN 'complete' ELSE 'pending' END) = 'complete'
        )::INT AS success_count,
        COUNT(*) FILTER (
          WHERE COALESCE(parse_status, CASE WHEN COALESCE(raw_text, '') <> '' THEN 'complete' ELSE 'pending' END) = 'failed'
        )::INT AS failure_count,
        AVG(COALESCE(parse_duration_ms, 0))::numeric(10,2) AS avg_duration_ms,
        COALESCE(SUM(token.total_tokens), 0)::bigint AS total_tokens,
        ROUND(COALESCE(AVG(token.total_tokens), 0), 2) AS avg_tokens_per_resume,
        ROUND(COALESCE(SUM(token.estimated_cost_usd), 0), 6) AS total_estimated_cost_usd,
        COUNT(*) FILTER (WHERE token.usage_available = true)::INT AS usage_available_count,
        COUNT(*) FILTER (WHERE token.usage_available = false)::INT AS usage_unavailable_count
      FROM resumes r
      LEFT JOIN LATERAL (
        SELECT t.*
        FROM resume_analysis_token_usage t
        WHERE t.resume_id = r.id
        ORDER BY t.created_at DESC
        LIMIT 1
      ) token ON true
      ${whereClause}`,
      params,
    )

    const breakdownResult = await pool.query(
      `SELECT
        COALESCE(file_type,
          CASE
            WHEN LOWER(filename) LIKE '%.pdf' THEN 'application/pdf'
            WHEN LOWER(filename) LIKE '%.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ELSE 'unknown'
          END
        ) AS file_type,
        COUNT(*)::INT AS count
      FROM resumes
      ${whereClause}
      GROUP BY 1
      ORDER BY count DESC`,
      params,
    )

    const failureResult = await pool.query(
      `SELECT parse_error, COUNT(*)::INT AS count
       FROM resumes r
       ${whereClause}${whereClause ? ' AND' : ' WHERE'} COALESCE(parse_status, '') = 'failed'
       GROUP BY parse_error
       ORDER BY count DESC`,
      params,
    )

    const timelineResult = await pool.query(
      `SELECT DATE_TRUNC('day', created_at)::date AS day,
              COUNT(*)::INT AS total,
              COUNT(*) FILTER (
                WHERE COALESCE(parse_status, CASE WHEN COALESCE(raw_text, '') <> '' THEN 'complete' ELSE 'pending' END) = 'complete'
              )::INT AS success
       FROM resumes r
       ${whereClause}
       GROUP BY 1
       ORDER BY day DESC
       LIMIT 30`,
      params,
    )

    const tokenTrendResult = await pool.query(
      `SELECT DATE_TRUNC('day', t.created_at)::date AS day,
              COALESCE(SUM(t.total_tokens), 0)::bigint AS total_tokens,
              ROUND(COALESCE(SUM(t.estimated_cost_usd), 0), 6) AS estimated_cost_usd
       FROM resume_analysis_token_usage t
       JOIN resumes r ON r.id = t.resume_id
       ${whereClause}
       GROUP BY 1
       ORDER BY day DESC
       LIMIT 30`,
      params,
    )

    const summary = summaryResult.rows[0] || {}
    const total = Number(summary.total || 0)
    const successCount = Number(summary.success_count || 0)

    return res.json({
      totalParses: total,
      successRate: total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : 0,
      avgTimeSeconds: Number((Number(summary.avg_duration_ms || 0) / 1000).toFixed(2)),
      tokenUsage: {
        totalTokens: Number(summary.total_tokens || 0),
        avgTokensPerResume: Number(summary.avg_tokens_per_resume || 0),
        totalEstimatedCostUsd: Number(summary.total_estimated_cost_usd || 0),
        usageAvailableCount: Number(summary.usage_available_count || 0),
        usageUnavailableCount: Number(summary.usage_unavailable_count || 0),
        costTrend: tokenTrendResult.rows
          .map((row) => ({
            day: row.day,
            totalTokens: Number(row.total_tokens || 0),
            estimatedCostUsd: Number(row.estimated_cost_usd || 0),
          }))
          .reverse(),
      },
      failures: {
        total: Number(summary.failure_count || 0),
        breakdown: failureResult.rows.map((row) => ({
          reason: classifyFailure(row.parse_error),
          count: Number(row.count || 0),
          sampleMessage: row.parse_error || null,
        })),
      },
      formatBreakdown: breakdownResult.rows.map((row) => ({
        format: getFormatLabel(row.file_type),
        mimeType: row.file_type,
        count: Number(row.count || 0),
      })),
      performanceOverTime: timelineResult.rows
        .map((row) => ({
          day: row.day,
          total: Number(row.total || 0),
          success: Number(row.success || 0),
        }))
        .reverse(),
    })
  } catch (error) {
    console.error('[Admin uploads] stats failed:', error)
    return res.status(500).json({ error: 'Unable to load upload stats' })
  }
})

router.get('/export', async (req, res) => {
  const { status = 'all', startDate, endDate } = req.query

  const where = []
  const params = []

  if (status && status !== 'all') {
    params.push(status)
    where.push(`COALESCE(r.parse_status, CASE WHEN COALESCE(r.raw_text, '') <> '' THEN 'complete' ELSE 'pending' END) = $${params.length}`)
  }

  if (startDate) {
    params.push(startDate)
    where.push(`r.created_at >= $${params.length}::timestamp`)
  }

  if (endDate) {
    params.push(endDate)
    where.push(`r.created_at <= $${params.length}::timestamp + INTERVAL '1 day'`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    await ensureUploadMonitoringColumns()

    const result = await pool.query(
      `SELECT r.id, r.filename, r.user_id, r.created_at, r.file_size, r.file_type, r.parse_status, r.parse_duration_ms, r.parse_error,
              token.usage_available, token.unavailable_reason, token.input_tokens, token.output_tokens, token.total_tokens, token.estimated_cost_usd
       FROM resumes r
       LEFT JOIN LATERAL (
         SELECT t.*
         FROM resume_analysis_token_usage t
         WHERE t.resume_id = r.id
         ORDER BY t.created_at DESC
         LIMIT 1
       ) token ON true
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT 5000`,
      params,
    )

    const header = ['id', 'filename', 'user_id', 'created_at', 'file_size', 'file_type', 'parse_status', 'parse_duration_ms', 'parse_error', 'usage_available', 'usage_unavailable_reason', 'input_tokens', 'output_tokens', 'total_tokens', 'estimated_cost_usd']
    const csvRows = [header.join(',')]

    for (const row of result.rows) {
      const values = [
        row.id,
        row.filename,
        row.user_id,
        toIso(row.created_at),
        Number(row.file_size || 0),
        row.file_type || '',
        normalizeStatus(row),
        Number(row.parse_duration_ms || 0),
        row.parse_error || '',
        row.usage_available === null || row.usage_available === undefined ? '' : String(Boolean(row.usage_available)),
        row.unavailable_reason || '',
        row.input_tokens === null || row.input_tokens === undefined ? '' : Number(row.input_tokens),
        row.output_tokens === null || row.output_tokens === undefined ? '' : Number(row.output_tokens),
        row.total_tokens === null || row.total_tokens === undefined ? '' : Number(row.total_tokens),
        row.estimated_cost_usd === null || row.estimated_cost_usd === undefined ? '' : Number(row.estimated_cost_usd),
      ].map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)

      csvRows.push(values.join(','))
    }

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="upload-logs.csv"')
    return res.status(200).send(csvRows.join('\n'))
  } catch (error) {
    console.error('[Admin uploads] export failed:', error)
    return res.status(500).json({ error: 'Unable to export upload logs' })
  }
})

router.get('/:uploadId', async (req, res) => {
  const { uploadId } = req.params

  try {
    await ensureUploadMonitoringColumns()

    const result = await pool.query(
      `SELECT r.id,
              r.user_id,
              u.email AS user_email,
              r.filename,
              r.raw_text,
              r.file_size,
              r.file_type,
              r.parse_status,
              r.parse_result,
              r.parse_error,
              r.parse_duration_ms,
              r.created_at,
              r.updated_at,
              r.retried_at,
              token.usage_available,
              token.unavailable_reason,
              token.provider AS token_provider,
              token.model AS token_model,
              token.input_tokens,
              token.output_tokens,
              token.total_tokens,
              token.estimated_cost_usd,
              token.created_at AS token_captured_at
       FROM resumes r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT t.*
         FROM resume_analysis_token_usage t
         WHERE t.resume_id = r.id
         ORDER BY t.created_at DESC
         LIMIT 1
       ) token ON true
       WHERE r.id::text = $1
       LIMIT 1`,
      [uploadId],
    )

    const row = result.rows[0]

    if (!row) {
      return res.status(404).json({ error: 'Upload not found' })
    }

    return res.json({ upload: mapUploadRow(row), retriedAt: toIso(row.retried_at) })
  } catch (error) {
    console.error('[Admin uploads] details failed:', error)
    return res.status(500).json({ error: 'Unable to load upload details' })
  }
})

async function handleRetryUpload(req, res) {
  const { uploadId } = req.params

  try {
    await ensureUploadMonitoringColumns()

    const result = await pool.query(
      `SELECT r.id, r.filename, p.job_id, p.status
       FROM resumes r
       LEFT JOIN parse_jobs p ON p.resume_id = r.id
       WHERE r.id::text = $1
       ORDER BY p.created_at DESC NULLS LAST
       LIMIT 1`,
      [uploadId],
    )

    const upload = result.rows[0]

    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' })
    }

    if (!upload.job_id) {
      return res.status(400).json({ error: 'No parse job found for this upload' })
    }

    const queueJob = await parseQueue.getJob(String(upload.job_id))
    if (!queueJob) {
      return res.status(404).json({ error: 'Queue job no longer exists (likely expired)' })
    }

    await pool.query(
      `UPDATE resumes
       SET parse_status = 'pending',
           parse_error = NULL,
           parse_result = NULL,
           parse_duration_ms = NULL,
           updated_at = NOW()
       WHERE id::text = $1`,
      [uploadId],
    )

    await pool.query(
      `UPDATE parse_jobs
       SET status = 'pending',
           progress = 0,
           result = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE job_id = $1`,
      [String(upload.job_id)],
    )

    await queueJob.retry()

    return res.json({
      ok: true,
      message: 'Parsing job has been requeued.',
      parseStatus: 'pending',
      jobId: String(upload.job_id),
    })
  } catch (error) {
    console.error('[Admin uploads] retry failed:', error)
    return res.status(500).json({ error: 'Unable to retry parsing for upload' })
  }
}

router.get('/:uploadId/retry', handleRetryUpload)
router.post('/:uploadId/retry', handleRetryUpload)

router.get('/:uploadId/raw-text', async (req, res) => {
  const { uploadId } = req.params

  try {
    await ensureUploadMonitoringColumns()

    const result = await pool.query(
      `SELECT filename, raw_text
       FROM resumes
       WHERE id::text = $1
       LIMIT 1`,
      [uploadId],
    )

    const row = result.rows[0]

    if (!row) {
      return res.status(404).json({ error: 'Upload not found' })
    }

    const baseName = String(row.filename || 'upload').replace(/\.[^.]+$/, '')

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}-raw-text.txt"`)
    return res.status(200).send(row.raw_text || '')
  } catch (error) {
    console.error('[Admin uploads] raw-text download failed:', error)
    return res.status(500).json({ error: 'Unable to download raw text' })
  }
})

export default router
