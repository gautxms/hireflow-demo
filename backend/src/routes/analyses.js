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

router.get('/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params

  try {
    const analysisResult = await pool.query(
      `SELECT id, user_id, status, created_at, completed_at, error_summary
       FROM analyses
       WHERE id = $1
       LIMIT 1`,
      [id],
    )

    const analysis = analysisResult.rows[0]

    if (!analysis || Number(analysis.user_id) !== Number(req.userId)) {
      return res.status(404).json({ error: 'Analysis not found' })
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
              pj.updated_at AS parse_job_updated_at
       FROM analysis_items ai
       LEFT JOIN resumes r ON r.id = ai.resume_id
       LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
       WHERE ai.analysis_id = $1
       ORDER BY ai.created_at ASC`,
      [id],
    )

    const items = []
    const failures = []

    const counts = {
      queued: 0,
      processing: 0,
      retrying: 0,
      complete: 0,
      failed: 0,
    }

    let maxProgress = 0

    for (const row of itemsResult.rows) {
      let queueState = null
      if (row.parse_job_id) {
        try {
          const queueJob = await parseQueue.getJob(String(row.parse_job_id))
          if (queueJob) {
            queueState = await queueJob.getState()
          }
        } catch (queueLookupError) {
          console.warn(
            `[Analyses] Failed queue lookup for parse job ${String(row.parse_job_id)}; using persisted status fallback.`,
            queueLookupError,
          )
        }
      }

      const canonicalStatus = resolveCanonicalParseStatus({
        queueState,
        parseJobState: row.parse_job_status || row.resume_parse_status,
        fallback: 'queued',
      })

      counts[canonicalStatus] = (counts[canonicalStatus] || 0) + 1

      const itemProgress = Number(row.progress || 0)
      if (itemProgress > maxProgress) {
        maxProgress = itemProgress
      }

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
        itemId: String(row.id),
        resumeId: String(row.resume_id || ''),
        parseJobId: row.parse_job_id ? String(row.parse_job_id) : null,
        filename: row.filename || null,
        status: canonicalStatus,
        progress: itemProgress,
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
        [
          analysis.id,
          aggregateStatus,
          computedCompletedAt,
          failures[0]?.error?.slice(0, 500) || null,
        ],
      )
    }

    return res.json({
      analysisId: String(analysis.id),
      status: aggregateStatus,
      progress: {
        total: totalItems,
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
