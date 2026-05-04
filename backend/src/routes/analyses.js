import multer from 'multer'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { parseQueue, enqueueParseJob } from '../services/jobQueue.js'
import { resolveCanonicalParseStatus } from '../services/parseStatusMapper.js'
import { requireActiveSubscription, enforceUploadLimit, trackUploadUsage } from '../middleware/subscriptionCheck.js'
import { sanitizeFilename } from '../utils/sanitize.js'
import { scanFileBuffer } from '../services/virusScanService.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 20 } })
const TERMINAL_STATUSES = new Set(['complete', 'failed'])

const deriveAggregateStatus = (counts, totalItems) => {
  if (totalItems === 0) return 'queued'
  if (counts.complete + counts.failed === totalItems) return counts.failed > 0 ? 'failed' : 'complete'
  if (counts.processing > 0 || counts.retrying > 0) return 'processing'
  return 'queued'
}

async function ensureAnalysisNameColumn() {
  await pool.query('ALTER TABLE analyses ADD COLUMN IF NOT EXISTS name TEXT')
}

router.get('/', requireAuth, async (req, res) => {
  await ensureAnalysisNameColumn()
  const result = await pool.query(
    `SELECT a.id, a.name, a.status, a.created_at, jd.title AS job_description_title,
      COUNT(ai.id)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) IN ('completed','complete'))::int AS complete,
      COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) IN ('failed'))::int AS failed,
      COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) IN ('active','processing','in_progress'))::int AS processing,
      COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) IN ('retrying'))::int AS retrying,
      COUNT(*) FILTER (WHERE COALESCE(pj.status, r.parse_status) IN ('pending','queued'))::int AS pending
     FROM analyses a
     LEFT JOIN analysis_items ai ON ai.analysis_id = a.id
     LEFT JOIN resumes r ON r.id = ai.resume_id
     LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
     LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
     WHERE a.user_id = $1
     GROUP BY a.id, jd.title
     ORDER BY a.created_at DESC`, [req.userId])

  return res.json({
    items: result.rows.map((row) => {
      const counts = {
        complete: Number(row.complete) || 0,
        failed: Number(row.failed) || 0,
        processing: Number(row.processing) || 0,
        retrying: Number(row.retrying) || 0,
      }
      const total = Number(row.total) || 0
      return {
        id: String(row.id),
        name: row.name || null,
        status: row.status,
        liveStatus: deriveAggregateStatus(counts, total),
        createdAt: row.created_at,
        jobDescriptionTitle: row.job_description_title || null,
        summary: { total, complete: counts.complete, failed: counts.failed, processing: counts.processing + counts.retrying, pending: Number(row.pending) || 0 },
      }
    }),
  })
})

router.post('/', requireAuth, requireActiveSubscription, enforceUploadLimit, (req,res,next)=>upload.array('resumes')(req,res,next), trackUploadUsage, async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'At least one resume file is required' })
  await ensureAnalysisNameColumn()
  const name = String(req.body.name || '').trim()
  if (!name || name.length > 80) return res.status(400).json({ error: 'Analysis name is required and must be 80 characters or fewer' })
  const jobDescriptionId = req.body.jobDescriptionId || null
  let analysisId = null
  try {
    if (jobDescriptionId) {
      const jdResult = await pool.query(
        `SELECT id
         FROM job_descriptions
         WHERE id = $1
           AND user_id = $2
           AND status <> 'archived'
         LIMIT 1`,
        [jobDescriptionId, req.userId],
      )

      if (!jdResult.rows[0]) {
        return res.status(400).json({ error: 'Selected job description is invalid or archived' })
      }
    }

    const inserted = await pool.query('INSERT INTO analyses (user_id, job_description_id, name, status) VALUES ($1,$2,$3,$4) RETURNING id,created_at,status', [req.userId, jobDescriptionId, name, 'queued'])
    analysisId = inserted.rows[0].id
    for (const f of req.files) {
      const safeName = sanitizeFilename(f.originalname)
      const scan = await scanFileBuffer(f.buffer, safeName)
      if (scan.malicious) throw new Error(`Upload rejected for ${safeName}: malware detected`)
      const fileBufferBase64 = f.buffer.toString('base64')
      const resume = await pool.query(`INSERT INTO resumes (user_id, filename, raw_text, file_size, file_type, parse_status, scan_status, scan_result, file_sha256, job_description_id, updated_at) VALUES ($1,$2,'',$3,$4,'pending',$5,$6::jsonb,encode(digest(decode($7,'base64'),'sha256'),'hex'),$8,NOW()) RETURNING id`, [req.userId, safeName, f.size, f.mimetype, scan.status || 'clean', JSON.stringify(scan), fileBufferBase64, jobDescriptionId])
      const resumeId = resume.rows[0].id
      const job = await enqueueParseJob({ resumeId, userId: req.userId, filename: safeName, mimeType: f.mimetype, fileSize: f.size, fileBufferBase64, jobDescriptionId })
      await pool.query('INSERT INTO analysis_items (analysis_id,resume_id,parse_job_id) VALUES ($1,$2,$3)', [analysisId, resumeId, String(job.id)])
    }
    return res.status(202).json({ analysis: { id: String(analysisId), name, status: 'queued', liveStatus: 'queued', createdAt: inserted.rows[0].created_at, jobDescriptionTitle: null, summary: { total: req.files.length, complete: 0, failed: 0, processing: 0, pending: req.files.length } } })
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
    if (analysisId) await pool.query('UPDATE analyses SET status=$2, completed_at=NOW(), error_summary=$3 WHERE id=$1', [analysisId, 'failed', String(error.message || 'Unable to queue upload request').slice(0, 500)])
    return res.status(500).json({ error: 'Unable to create analysis' })
  }
})

router.get('/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params
  try {
    const analysisResult = await pool.query(`SELECT id, user_id, status, created_at, completed_at, error_summary FROM analyses WHERE id = $1 LIMIT 1`, [id])
    const analysis = analysisResult.rows[0]
    if (!analysis || Number(analysis.user_id) !== Number(req.userId)) return res.status(404).json({ error: 'Analysis not found' })
    const itemsResult = await pool.query(`SELECT ai.id,ai.resume_id,ai.parse_job_id,ai.created_at,r.filename,r.parse_status AS resume_parse_status,r.parse_error,pj.status AS parse_job_status,pj.progress,pj.error_message,pj.updated_at AS parse_job_updated_at FROM analysis_items ai LEFT JOIN resumes r ON r.id = ai.resume_id LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id WHERE ai.analysis_id = $1 ORDER BY ai.created_at ASC`, [id])
    const items=[];const failures=[];const counts={queued:0,processing:0,retrying:0,complete:0,failed:0};let maxProgress=0
    for (const row of itemsResult.rows) { let queueState=null; if(row.parse_job_id){try{const queueJob=await parseQueue.getJob(String(row.parse_job_id)); if(queueJob){queueState=await queueJob.getState()}} catch (queueLookupError) {
        console.warn(`[Analyses] Queue lookup fallback for parse job ${String(row.parse_job_id)}`, queueLookupError)
      }} const canonicalStatus=resolveCanonicalParseStatus({queueState,parseJobState:row.parse_job_status || row.resume_parse_status,fallback:'queued'}); counts[canonicalStatus]=(counts[canonicalStatus]||0)+1; const itemProgress=Number(row.progress||0); if(itemProgress>maxProgress) maxProgress=itemProgress; if(canonicalStatus==='failed'){failures.push({resumeId:String(row.resume_id||''),parseJobId:row.parse_job_id?String(row.parse_job_id):null,filename:row.filename||null,status:canonicalStatus,error:row.error_message||row.parse_error||'Unknown parse failure'})} items.push({itemId:String(row.id),resumeId:String(row.resume_id||''),parseJobId:row.parse_job_id?String(row.parse_job_id):null,filename:row.filename||null,status:canonicalStatus,progress:itemProgress}) }
    const totalItems = items.length; const completedItems = counts.complete + counts.failed; const aggregateStatus = deriveAggregateStatus(counts, totalItems); const isComplete = totalItems > 0 && completedItems === totalItems; const percentComplete = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
    const computedCompletedAt = isComplete ? (analysis.completed_at || new Date().toISOString()) : null
    if (aggregateStatus !== analysis.status || String(analysis.completed_at || '') !== String(computedCompletedAt || '')) await pool.query(`UPDATE analyses SET status = $2, completed_at = $3, error_summary = $4 WHERE id = $1`, [analysis.id, aggregateStatus, computedCompletedAt, failures[0]?.error?.slice(0, 500) || null])
    return res.json({ analysisId: String(analysis.id), status: aggregateStatus, progress: { total: totalItems, completed: counts.complete, failed: counts.failed, queued: counts.queued, processing: counts.processing, retrying: counts.retrying, percent: percentComplete }, failures, completion: { isComplete, completedAt: computedCompletedAt, createdAt: analysis.created_at, hasFailures: failures.length > 0, errorSummary: failures[0]?.error || analysis.error_summary || null, terminal: isComplete && TERMINAL_STATUSES.has(aggregateStatus) }, items, maxItemProgress: maxProgress })
  } catch { return res.status(500).json({ error: 'Unable to fetch analysis status' }) }
})

export default router
