import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { requireActiveSubscription } from '../middleware/subscriptionCheck.js'
import { cancelParseJobsByIds, parseQueue } from '../services/jobQueue.js'
import {
  buildAnalysisDetailPayload,
  deriveAnalysisAggregateStatus,
  loadAnalysisReadModel,
  mapAnalysisUploadChunkStatus,
  normalizeJobDescriptionTitle,
} from '../services/analysisReadModelService.js'
import { releaseResumeQuotaAllocationsForAnalysis } from '../services/resumeQuotaReservations.js'
import { getDisplayFilename } from '../utils/resumeFileMetadata.js'

const router = Router()

const TERMINAL_STATUSES = new Set(['complete', 'failed'])

function buildUploadChunkFile(row) {
  const filename = row.filename || 'Unknown file'
  return {
    name: filename,
    filename,
    originalFilename: filename,
    fileExtension: null,
    mimeType: row.mime_type || null,
    originalMimeType: row.mime_type || null,
    status: mapAnalysisUploadChunkStatus(row),
    source: 'upload_chunk',
  }
}


function normalizeAnalysisFileKey(value) {
  return String(value || '').trim().toLowerCase()
}

function buildAnalysisItemIdentitySet(rows) {
  const identities = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const analysisId = normalizeAnalysisFileKey(row.analysis_id)
    if (!analysisId) continue
    const resumeId = normalizeAnalysisFileKey(row.resume_id)
    const parseJobId = normalizeAnalysisFileKey(row.parse_job_id)
    const filename = normalizeAnalysisFileKey(row.original_filename || row.filename)
    if (resumeId) identities.add(`${analysisId}:resume:${resumeId}`)
    if (parseJobId) identities.add(`${analysisId}:parse:${parseJobId}`)
    if (filename) identities.add(`${analysisId}:file:${filename}`)
  }
  return identities
}

function isUploadChunkAlreadyRepresented(row, analysisItemIdentities) {
  const analysisId = normalizeAnalysisFileKey(row?.analysis_id)
  if (!analysisId) return false
  const resumeId = normalizeAnalysisFileKey(row?.resume_id)
  const parseJobId = normalizeAnalysisFileKey(row?.parse_job_id)
  const filename = normalizeAnalysisFileKey(row?.filename)
  return Boolean(
    (resumeId && analysisItemIdentities.has(`${analysisId}:resume:${resumeId}`))
    || (parseJobId && analysisItemIdentities.has(`${analysisId}:parse:${parseJobId}`))
    || (filename && analysisItemIdentities.has(`${analysisId}:file:${filename}`)),
  )
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id,
              a.created_at,
              a.status,
              a.name,
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

    const failedItemsResult = await pool.query(
      `SELECT ai.analysis_id,
              ai.resume_id,
              ai.parse_job_id,
              r.filename,
              r.original_filename,
              r.file_extension,
              r.original_mime_type,
              r.file_type,
              COALESCE(pj.status, r.parse_status, 'failed') AS status,
              COALESCE(NULLIF(pj.error_message, ''), NULLIF(r.parse_error, '')) AS error,
              ai.created_at
       FROM analysis_items ai
       INNER JOIN analyses a ON a.id = ai.analysis_id
       LEFT JOIN resumes r ON r.id = ai.resume_id
       LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
       WHERE a.user_id = $1
         AND COALESCE(pj.status, r.parse_status) = 'failed'
       ORDER BY ai.analysis_id ASC, ai.created_at ASC`,
      [req.userId],
    )

    const failedItemsByAnalysis = new Map()
    for (const row of failedItemsResult.rows) {
      const analysisId = String(row.analysis_id || '')
      if (!analysisId) continue
      const existingItems = failedItemsByAnalysis.get(analysisId) || []
      if (existingItems.length >= 5) continue
      existingItems.push({
        filename: getDisplayFilename(row),
        originalFilename: row.original_filename || row.filename || null,
        fileExtension: row.file_extension || null,
        mimeType: row.file_type || null,
        originalMimeType: row.original_mime_type || null,
        status: row.status || 'failed',
      })
      failedItemsByAnalysis.set(analysisId, existingItems)
    }

    const filesByAnalysisResult = await pool.query(
      `SELECT ai.analysis_id,
              ai.resume_id,
              ai.parse_job_id,
              r.filename,
              r.original_filename,
              r.file_extension,
              r.original_mime_type,
              r.file_type,
              COALESCE(pj.status, r.parse_status, 'queued') AS status,
              ai.created_at
       FROM analysis_items ai
       INNER JOIN analyses a ON a.id = ai.analysis_id
       LEFT JOIN resumes r ON r.id = ai.resume_id
       LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
       WHERE a.user_id = $1
       ORDER BY ai.analysis_id ASC, ai.created_at ASC`,
      [req.userId],
    )

    const uploadFilesResult = await pool.query(
      `SELECT uc.analysis_id,
              uc.upload_id,
              uc.filename,
              uc.mime_type,
              uc.status,
              uc.resume_id,
              uc.parse_job_id,
              uc.created_at,
              uc.updated_at
       FROM upload_chunks uc
       INNER JOIN analyses a ON a.id = uc.analysis_id
       WHERE a.user_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM analysis_items ai
           LEFT JOIN resumes r ON r.id = ai.resume_id
           WHERE ai.analysis_id = uc.analysis_id
             AND (
               (uc.resume_id IS NOT NULL AND ai.resume_id = uc.resume_id)
               OR (uc.parse_job_id IS NOT NULL AND ai.parse_job_id = uc.parse_job_id)
               OR (LOWER(TRIM(COALESCE(uc.filename, ''))) <> ''
                   AND LOWER(TRIM(COALESCE(r.original_filename, r.filename, ''))) = LOWER(TRIM(uc.filename)))
             )
         )
       ORDER BY uc.analysis_id ASC, uc.created_at ASC`,
      [req.userId],
    )

    const analysisItemIdentities = buildAnalysisItemIdentitySet(filesByAnalysisResult.rows)
    const orphanUploadRows = uploadFilesResult.rows.filter((row) => !isUploadChunkAlreadyRepresented(row, analysisItemIdentities))

    const uploadSummariesByAnalysis = new Map()
    for (const row of orphanUploadRows) {
      const analysisId = String(row.analysis_id || '')
      if (!analysisId) continue
      const existingSummary = uploadSummariesByAnalysis.get(analysisId) || { total: 0, failed: 0, processing: 0 }
      const uploadStatus = mapAnalysisUploadChunkStatus(row)
      existingSummary.total += 1
      if (uploadStatus === 'failed') existingSummary.failed += 1
      else existingSummary.processing += 1
      uploadSummariesByAnalysis.set(analysisId, existingSummary)
    }

    const filesByAnalysis = new Map()
    for (const row of filesByAnalysisResult.rows) {
      const analysisId = String(row.analysis_id || '')
      if (!analysisId) continue
      const existingItems = filesByAnalysis.get(analysisId) || []
      existingItems.push({
        name: (row.filename || row.original_filename) ? getDisplayFilename(row) : 'Unknown file',
        filename: (row.filename || row.original_filename) ? getDisplayFilename(row) : null,
        originalFilename: row.original_filename || row.filename || null,
        fileExtension: row.file_extension || null,
        mimeType: row.file_type || null,
        originalMimeType: row.original_mime_type || null,
        status: row.status || 'queued',
      })
      filesByAnalysis.set(analysisId, existingItems)
    }

    for (const row of orphanUploadRows) {
      const analysisId = String(row.analysis_id || '')
      if (!analysisId) continue
      const existingItems = filesByAnalysis.get(analysisId) || []
      existingItems.push(buildUploadChunkFile(row))
      filesByAnalysis.set(analysisId, existingItems)
    }

    const items = result.rows.map((row) => {
      const uploadSummary = uploadSummariesByAnalysis.get(String(row.id)) || { total: 0, failed: 0, processing: 0 }
      const summary = {
        total: Number(row.total_count || 0) + uploadSummary.total,
        complete: Number(row.complete_count || 0),
        failed: Number(row.failed_count || 0) + uploadSummary.failed,
        processing: Number(row.processing_count || 0) + uploadSummary.processing,
      }
      return {
        id: String(row.id),
        createdAt: row.created_at,
        name: row.name || null,
        status: row.status || 'queued',
        liveStatus: deriveAnalysisAggregateStatus({
          queued: Math.max(0, summary.total - summary.complete - summary.failed - summary.processing),
          processing: summary.processing,
          retrying: 0,
          complete: summary.complete,
          failed: summary.failed,
        }, summary.total),
        summary: { ...summary, pending: Math.max(0, summary.total - summary.complete - summary.failed - summary.processing) },
        failedItems: failedItemsByAnalysis.get(String(row.id)) || [],
        fileCount: summary.total,
        files: filesByAnalysis.get(String(row.id)) || [],
        filesPreview: (filesByAnalysis.get(String(row.id)) || []).slice(0, 5),
        jobDescriptionTitle: normalizeJobDescriptionTitle(row.job_description_title),
      }
    })

    return res.json({ items })
  } catch (error) {
    console.error('[Analyses] Failed to fetch analyses:', error)
    return res.status(500).json({ error: 'Unable to fetch analyses' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  const analysisData = await loadAnalysisReadModel({ analysisId: req.params.id, userId: req.userId, queue: parseQueue }).catch((error) => {
    console.error('[Analyses] Failed to fetch analysis details:', error)
    return '__error__'
  })
  if (analysisData === '__error__') return res.status(500).json({ error: 'Unable to fetch analysis status' })
  if (!analysisData) return res.status(404).json({ error: 'Analysis not found' })

  return res.json(buildAnalysisDetailPayload(analysisData))
})

router.get('/:id/status', requireAuth, async (req, res) => {
  try {
    const analysisData = await loadAnalysisReadModel({ analysisId: req.params.id, userId: req.userId, queue: parseQueue })
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


router.delete('/:id', requireAuth, requireActiveSubscription, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const ownershipResult = await client.query(
      'SELECT id FROM analyses WHERE id = $1 AND user_id = $2 LIMIT 1',
      [req.params.id, req.userId],
    )

    if (ownershipResult.rowCount === 0) {
      const existenceResult = await client.query('SELECT id FROM analyses WHERE id = $1 LIMIT 1', [req.params.id])
      await client.query('ROLLBACK')
      if (existenceResult.rowCount === 0) return res.status(404).json({ error: 'Analysis not found' })
      return res.status(403).json({ error: 'Forbidden' })
    }

    const parseJobsResult = await client.query(
      `SELECT parse_job_id
       FROM analysis_items
       WHERE analysis_id = $1
         AND parse_job_id IS NOT NULL`,
      [req.params.id],
    )
    const parseJobIds = parseJobsResult.rows.map((row) => row.parse_job_id).filter(Boolean)

    await releaseResumeQuotaAllocationsForAnalysis({
      client,
      userId: req.userId,
      analysisId: req.params.id,
    })

    await cancelParseJobsByIds(parseJobIds, { logger: console })

    if (parseJobIds.length > 0) {
      await client.query(
        `UPDATE parse_jobs
         SET status = 'cancelled',
             progress = CASE WHEN progress < 100 THEN 100 ELSE progress END,
             error_message = COALESCE(NULLIF(error_message, ''), 'Analysis was deleted before parsing completed'),
             updated_at = NOW()
         WHERE job_id = ANY($1::text[])
           AND status IN ('pending', 'queued', 'processing', 'retrying')`,
        [parseJobIds.map((jobId) => String(jobId))],
      )
    }

    await client.query('DELETE FROM analysis_items WHERE analysis_id = $1', [req.params.id])
    await client.query('DELETE FROM analyses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])

    await client.query('COMMIT')
    return res.status(200).json({ ok: true, deletedAnalysisId: String(req.params.id), resumePolicy: 'retained' })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Analyses] Failed to delete analysis:', error)
    return res.status(500).json({ error: 'Unable to delete analysis' })
  } finally {
    client.release()
  }
})

export default router
