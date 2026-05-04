import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { parseQueue } from '../services/jobQueue.js'
import { resolveCanonicalParseStatus } from '../services/parseStatusMapper.js'

const router = Router()

const TERMINAL_STATUSES = new Set(['complete', 'failed'])

function deriveAggregateStatus(counts, totalItems) {
  if (totalItems === 0) return 'queued'

  const terminalCount = counts.complete + counts.failed
  if (terminalCount === totalItems) {
    return counts.failed > 0 ? 'failed' : 'complete'
  }

  if (counts.processing > 0 || counts.retrying > 0) {
    return 'processing'
  }

  return 'queued'
}

async function loadAnalysisStatus(analysisId, userId) {
  const analysisResult = await pool.query(
    `SELECT a.id,
            a.user_id,
            a.status,
            a.created_at,
            a.completed_at,
            a.error_summary,
            a.job_description_id,
            jd.title AS job_description_title
     FROM analyses a
     LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
     WHERE a.id = $1
     LIMIT 1`,
    [analysisId],
  )

  const analysis = analysisResult.rows[0]
  if (!analysis || Number(analysis.user_id) !== Number(userId)) {
    return null
  }

  const itemsResult = await pool.query(
    `SELECT ai.id,
            ai.resume_id,
            ai.parse_job_id,
            ai.created_at,
            r.filename,
            r.parse_status AS resume_parse_status,
            r.parse_error,
            pj.status AS parse_job_status,
            pj.progress,
            pj.error_message,
            pj.updated_at AS parse_job_updated_at,
            pj.result AS parse_result
     FROM analysis_items ai
     LEFT JOIN resumes r ON r.id = ai.resume_id
     LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
     WHERE ai.analysis_id = $1
     ORDER BY ai.created_at ASC`,
    [analysisId],
  )

  const items = []
  const failures = []
  const counts = { queued: 0, processing: 0, retrying: 0, complete: 0, failed: 0 }
  let maxProgress = 0

  for (const row of itemsResult.rows) {
    let queueState = null
    if (row.parse_job_id) {
      try {
        const queueJob = await parseQueue.getJob(String(row.parse_job_id))
        if (queueJob) queueState = await queueJob.getState()
      } catch (queueLookupError) {
        console.warn(`[Analyses] Failed queue lookup for parse job ${String(row.parse_job_id)}; using persisted status fallback.`, queueLookupError)
      }
    }

    const canonicalStatus = resolveCanonicalParseStatus({
      queueState,
      parseJobState: row.parse_job_status || row.resume_parse_status,
      fallback: 'queued',
    })

    counts[canonicalStatus] = (counts[canonicalStatus] || 0) + 1
    const itemProgress = Number(row.progress || 0)
    if (itemProgress > maxProgress) maxProgress = itemProgress

    if (canonicalStatus === 'failed') {
      failures.push({
        resumeId: String(row.resume_id || ''),
        parseJobId: row.parse_job_id ? String(row.parse_job_id) : null,
        filename: row.filename || null,
        status: canonicalStatus,
        error: row.error_message || row.parse_error || 'Unknown parse failure',
      })
    }

    items.push({
      id: String(row.id),
      itemId: String(row.id),
      resumeId: String(row.resume_id || ''),
      parseJobId: row.parse_job_id ? String(row.parse_job_id) : null,
      filename: row.filename || null,
      status: canonicalStatus,
      progress: itemProgress,
      createdAt: row.created_at,
      updatedAt: row.parse_job_updated_at || row.created_at,
      error: row.error_message || row.parse_error || null,
      result: row.parse_result ?? null,
    })
  }

  const totalItems = items.length
  const completedItems = counts.complete + counts.failed
  const aggregateStatus = deriveAggregateStatus(counts, totalItems)
  const isComplete = totalItems > 0 && completedItems === totalItems
  const percentComplete = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
  const computedCompletedAt = isComplete ? (analysis.completed_at || new Date().toISOString()) : null

  if (aggregateStatus !== analysis.status || String(analysis.completed_at || '') !== String(computedCompletedAt || '')) {
    await pool.query(
      `UPDATE analyses
       SET status = $2,
           completed_at = $3,
           error_summary = $4
       WHERE id = $1`,
      [analysis.id, aggregateStatus, computedCompletedAt, failures[0]?.error?.slice(0, 500) || null],
    )
  }

  return {
    analysis,
    items,
    failures,
    counts,
    aggregateStatus,
    isComplete,
    percentComplete,
    computedCompletedAt,
    maxProgress,
  }
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id,
              a.created_at,
              a.status,
              a.job_description_id,
              jd.title AS job_description_title,
              COUNT(ai.id) AS total_count,
              COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) = 'complete') AS complete_count,
              COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) = 'failed') AS failed_count,
              COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) IN ('processing', 'retrying')) AS processing_count
       FROM analyses a
       LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
       LEFT JOIN analysis_items ai ON ai.analysis_id = a.id
       LEFT JOIN resumes r ON r.id = ai.resume_id
       LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
       WHERE a.user_id = $1
       GROUP BY a.id, jd.title
       ORDER BY a.created_at DESC`,
      [req.userId],
    )

    const items = result.rows.map((row) => {
      const summary = {
        total: Number(row.total_count || 0),
        complete: Number(row.complete_count || 0),
        failed: Number(row.failed_count || 0),
        processing: Number(row.processing_count || 0),
      }
      return {
        id: String(row.id),
        createdAt: row.created_at,
        status: row.status || 'queued',
        liveStatus: row.status || 'queued',
        summary: { ...summary, pending: Math.max(0, summary.total - summary.complete - summary.failed - summary.processing) },
        jobDescriptionTitle: row.job_description_title || null,
      }
    })

    return res.json({ items })
  } catch (error) {
    console.error('[Analyses] Failed to fetch analyses:', error)
    return res.status(500).json({ error: 'Unable to fetch analyses' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  const analysisData = await loadAnalysisStatus(req.params.id, req.userId).catch((error) => {
    console.error('[Analyses] Failed to fetch analysis details:', error)
    return '__error__'
  })
  if (analysisData === '__error__') return res.status(500).json({ error: 'Unable to fetch analysis status' })
  if (!analysisData) return res.status(404).json({ error: 'Analysis not found' })

  const { analysis, aggregateStatus, counts, items, computedCompletedAt } = analysisData
  return res.json({
    id: String(analysis.id),
    analysisId: String(analysis.id),
    createdAt: analysis.created_at,
    completedAt: computedCompletedAt,
    status: aggregateStatus,
    liveStatus: aggregateStatus,
    summary: {
      total: items.length,
      complete: counts.complete,
      failed: counts.failed,
      processing: counts.processing + counts.retrying,
      pending: counts.queued,
    },
    jobDescriptionId: analysis.job_description_id ? String(analysis.job_description_id) : null,
    jobDescriptionTitle: analysis.job_description_title || null,
    items,
  })
})

router.get('/:id/status', requireAuth, async (req, res) => {
  try {
    const analysisData = await loadAnalysisStatus(req.params.id, req.userId)
    if (!analysisData) {
      return res.status(404).json({ error: 'Analysis not found' })
    }
    const { analysis, aggregateStatus, counts, failures, items, isComplete, percentComplete, computedCompletedAt, maxProgress } = analysisData

    return res.json({
      analysisId: String(analysis.id),
      status: aggregateStatus,
      progress: {
        total: items.length,
        completed: counts.complete,
        failed: counts.failed,
        queued: counts.queued,
        processing: counts.processing,
        retrying: counts.retrying,
        percent: percentComplete,
      },
      failures,
      completion: {
        isComplete,
        completedAt: computedCompletedAt,
        createdAt: analysis.created_at,
        hasFailures: failures.length > 0,
        errorSummary: failures[0]?.error || analysis.error_summary || null,
        terminal: isComplete && TERMINAL_STATUSES.has(aggregateStatus),
      },
      items,
      maxItemProgress: maxProgress,
    })
  } catch (error) {
    console.error('[Analyses] Failed to fetch analysis status:', error)
    return res.status(500).json({ error: 'Unable to fetch analysis status' })
  }
})

export default router
