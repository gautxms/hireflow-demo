import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

function summarizeItemStatuses(items = []) {
  const summary = {
    total: items.length,
    complete: 0,
    failed: 0,
    processing: 0,
    pending: 0,
  }

  items.forEach((item) => {
    const status = String(item.status || '').toLowerCase()
    if (status === 'complete' || status === 'completed') {
      summary.complete += 1
      return
    }
    if (status === 'failed') {
      summary.failed += 1
      return
    }
    if (status === 'processing' || status === 'active' || status === 'retrying') {
      summary.processing += 1
      return
    }
    summary.pending += 1
  })

  return summary
}

function resolveLiveStatus(summary) {
  if (summary.total === 0) {
    return 'pending'
  }

  if (summary.processing > 0 || summary.pending > 0) {
    return 'processing'
  }

  if (summary.failed > 0 && summary.complete > 0) {
    return 'partial'
  }

  if (summary.failed === summary.total) {
    return 'failed'
  }

  return 'complete'
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '25'), 10) || 25, 1), 100)

    const analysisRows = await pool.query(
      `SELECT a.id,
              a.status,
              a.created_at,
              a.completed_at,
              a.error_summary,
              a.job_description_id,
              COALESCE(jd.title, '') AS job_description_title
         FROM analyses a
    LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
        WHERE a.user_id = $1
     ORDER BY a.created_at DESC
        LIMIT $2`,
      [req.userId, limit],
    )

    const analyses = []

    for (const row of analysisRows.rows) {
      const statusRows = await pool.query(
        `SELECT pj.status
           FROM analysis_items ai
      LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
          WHERE ai.analysis_id = $1`,
        [row.id],
      )

      const summary = summarizeItemStatuses(statusRows.rows)
      const liveStatus = resolveLiveStatus(summary)

      analyses.push({
        id: row.id,
        status: row.status,
        liveStatus,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        errorSummary: row.error_summary,
        jobDescriptionId: row.job_description_id,
        jobDescriptionTitle: row.job_description_title || null,
        summary,
      })
    }

    return res.json({
      items: analyses,
    })
  } catch (error) {
    console.error('[Analyses] Failed to list analyses:', error)
    return res.status(500).json({ error: 'Unable to list analyses' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const analysisResult = await pool.query(
      `SELECT a.id,
              a.user_id,
              a.status,
              a.created_at,
              a.completed_at,
              a.error_summary,
              a.job_description_id,
              COALESCE(jd.title, '') AS job_description_title
         FROM analyses a
    LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
        WHERE a.id = $1
        LIMIT 1`,
      [req.params.id],
    )

    const analysis = analysisResult.rows[0]
    if (!analysis || Number(analysis.user_id) !== Number(req.userId)) {
      return res.status(404).json({ error: 'Analysis not found' })
    }

    const itemRows = await pool.query(
      `SELECT ai.id,
              ai.resume_id,
              ai.parse_job_id,
              ai.created_at,
              COALESCE(r.filename, '') AS filename,
              COALESCE(pj.status, 'pending') AS status,
              COALESCE(pj.progress, 0) AS progress,
              pj.error_message,
              pj.updated_at,
              pj.result
         FROM analysis_items ai
    LEFT JOIN resumes r ON r.id = ai.resume_id
    LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
        WHERE ai.analysis_id = $1
     ORDER BY ai.created_at ASC`,
      [analysis.id],
    )

    const items = itemRows.rows.map((row) => ({
      id: row.id,
      resumeId: row.resume_id,
      parseJobId: row.parse_job_id,
      filename: row.filename || null,
      status: row.status,
      progress: Number(row.progress || 0),
      error: row.error_message || null,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      result: row.result || null,
    }))

    const summary = summarizeItemStatuses(items)

    return res.json({
      id: analysis.id,
      status: analysis.status,
      liveStatus: resolveLiveStatus(summary),
      createdAt: analysis.created_at,
      completedAt: analysis.completed_at,
      errorSummary: analysis.error_summary,
      jobDescriptionId: analysis.job_description_id,
      jobDescriptionTitle: analysis.job_description_title || null,
      summary,
      items,
    })
  } catch (error) {
    console.error('[Analyses] Failed to fetch analysis:', error)
    return res.status(500).json({ error: 'Unable to fetch analysis' })
  }
})

export default router
