import { pool } from '../db/client.js'
import { resolveCanonicalParseStatus } from './parseStatusMapper.js'
import { getDisplayFilename } from '../utils/resumeFileMetadata.js'

const FAILED_UPLOAD_STATUSES = new Set(['failed', 'rejected', 'expired'])
const STALE_UPLOAD_TIMEOUT_MINUTES = 30

export function normalizeJobDescriptionTitle(title) {
  const normalizedTitle = String(title || '').trim()
  if (!normalizedTitle) return null
  return normalizedTitle.replace(/^job\s+title\s*:?\s+/i, '').trim() || null
}

export function mapAnalysisUploadChunkStatus(row, { now = new Date() } = {}) {
  const status = String(row?.status || '').toLowerCase()
  if (FAILED_UPLOAD_STATUSES.has(status)) return 'failed'
  if (status === 'uploading') {
    const updatedAt = row?.updated_at ? new Date(row.updated_at) : null
    if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
      const ageMs = now.getTime() - updatedAt.getTime()
      if (ageMs > STALE_UPLOAD_TIMEOUT_MINUTES * 60 * 1000) return 'failed'
    }
  }
  return 'processing'
}

function buildUploadChunkItem(row, { now }) {
  const status = mapAnalysisUploadChunkStatus(row, { now })
  return {
    id: `upload:${String(row.upload_id)}`,
    itemId: `upload:${String(row.upload_id)}`,
    uploadId: String(row.upload_id),
    resumeId: '',
    parseJobId: row.parse_job_id ? String(row.parse_job_id) : null,
    filename: row.filename || 'Unknown file',
    originalFilename: row.filename || null,
    fileExtension: null,
    mimeType: row.mime_type || null,
    originalMimeType: row.mime_type || null,
    status,
    source: 'upload_chunk',
    progress: status === 'failed' ? 100 : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    error: status === 'failed' ? `Upload ${row.status || 'failed'}` : null,
    result: null,
    normalizedCandidates: [],
  }
}

function safeParseResult(result) {
  if (result == null) return null
  if (typeof result === 'string') {
    try {
      return JSON.parse(result)
    } catch {
      return null
    }
  }
  return typeof result === 'object' ? result : null
}

function extractCandidatesFromResult(result) {
  const diagnostics = {
    parseableObject: false,
    malformed: false,
  }

  const resolveObject = (value, depth = 0) => {
    if (depth > 4 || value == null) return null
    if (typeof value === 'string') {
      try {
        return resolveObject(JSON.parse(value), depth + 1)
      } catch {
        diagnostics.malformed = true
        return null
      }
    }
    if (typeof value !== 'object') return null
    return value
  }

  const parsed = resolveObject(result)
  if (!parsed || typeof parsed !== 'object') {
    return {
      candidates: [],
      diagnostics,
      normalizedResult: safeParseResult(result),
    }
  }

  diagnostics.parseableObject = true
  for (const field of [parsed.candidates, parsed.results, parsed.output]) {
    if (Array.isArray(field)) {
      return { candidates: field, diagnostics, normalizedResult: parsed }
    }
    const nested = resolveObject(field)
    if (nested && Array.isArray(nested.candidates)) {
      return { candidates: nested.candidates, diagnostics, normalizedResult: parsed }
    }
  }

  return { candidates: [], diagnostics, normalizedResult: parsed }
}

export function deriveAnalysisAggregateStatus(counts, totalItems) {
  if (totalItems === 0) return 'queued'

  const terminalCount = counts.complete + counts.failed
  if (terminalCount === totalItems) {
    return counts.failed > 0 ? 'failed' : 'complete'
  }
  if (counts.processing > 0 || counts.retrying > 0) return 'processing'
  return 'queued'
}

export function buildAnalysisDetailPayload(readModel) {
  if (!readModel) return null
  const { analysis, aggregateStatus, counts, items, computedCompletedAt, extractionDiagnostics } = readModel
  return {
    id: String(analysis.id),
    analysisId: String(analysis.id),
    name: analysis.name || null,
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
    jobDescriptionTitle: normalizeJobDescriptionTitle(analysis.job_description_title),
    items,
    diagnostics: {
      resultExtraction: extractionDiagnostics,
    },
  }
}

export async function loadAnalysisReadModel({
  analysisId,
  userId,
  db = pool,
  queue = null,
  now = new Date(),
} = {}) {
  const analysisResult = await db.query(
    `SELECT a.id,
            a.user_id,
            a.status,
            a.name,
            a.created_at,
            a.completed_at,
            a.error_summary,
            a.job_description_id,
            jd.title AS job_description_title
     FROM analyses a
     LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
     WHERE a.id = $1 AND a.user_id = $2
     LIMIT 1`,
    [analysisId, userId],
  )

  const analysis = analysisResult.rows[0]
  if (!analysis || Number(analysis.user_id) !== Number(userId)) return null

  const itemsResult = await db.query(
    `SELECT ai.id,
            ai.resume_id,
            ai.parse_job_id,
            ai.created_at,
            r.filename,
            r.original_filename,
            r.file_extension,
            r.original_mime_type,
            r.file_type,
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
  const extractionDiagnostics = { totalItems: 0, parseableObjectCount: 0, candidateBearingItemCount: 0, malformedItemCount: 0 }
  let maxProgress = 0

  for (const row of itemsResult.rows) {
    let queueState = null
    if (queue && row.parse_job_id) {
      try {
        const queueJob = await queue.getJob(String(row.parse_job_id))
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
        filename: getDisplayFilename(row),
        originalFilename: row.original_filename || row.filename || null,
        fileExtension: row.file_extension || null,
        mimeType: row.file_type || null,
        originalMimeType: row.original_mime_type || null,
        status: canonicalStatus,
        error: row.error_message || row.parse_error || 'Unknown parse failure',
      })
    }

    const extracted = extractCandidatesFromResult(row.parse_result)
    extractionDiagnostics.totalItems += 1
    if (extracted.diagnostics.parseableObject) extractionDiagnostics.parseableObjectCount += 1
    if (extracted.diagnostics.malformed) extractionDiagnostics.malformedItemCount += 1
    if (extracted.candidates.length > 0) extractionDiagnostics.candidateBearingItemCount += 1

    items.push({
      id: String(row.id),
      itemId: String(row.id),
      resumeId: String(row.resume_id || ''),
      parseJobId: row.parse_job_id ? String(row.parse_job_id) : null,
      filename: getDisplayFilename(row),
      originalFilename: row.original_filename || row.filename || null,
      fileExtension: row.file_extension || null,
      mimeType: row.file_type || null,
      originalMimeType: row.original_mime_type || null,
      status: canonicalStatus,
      progress: itemProgress,
      createdAt: row.created_at,
      updatedAt: row.parse_job_updated_at || row.created_at,
      error: row.error_message || row.parse_error || null,
      result: extracted.normalizedResult,
      normalizedCandidates: extracted.candidates,
    })
  }

  const uploadChunksResult = await db.query(
    `SELECT uc.upload_id,
            uc.filename,
            uc.mime_type,
            uc.status,
            uc.resume_id,
            uc.parse_job_id,
            uc.created_at,
            uc.updated_at
     FROM upload_chunks uc
     WHERE uc.analysis_id = $1
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
     ORDER BY uc.created_at ASC`,
    [analysisId],
  )

  for (const row of uploadChunksResult.rows) {
    const placeholder = buildUploadChunkItem(row, { now })
    counts[placeholder.status] = (counts[placeholder.status] || 0) + 1
    if (placeholder.status === 'failed') {
      failures.push({
        resumeId: '',
        parseJobId: placeholder.parseJobId,
        uploadId: placeholder.uploadId,
        filename: placeholder.filename,
        originalFilename: placeholder.originalFilename,
        fileExtension: null,
        mimeType: placeholder.mimeType,
        originalMimeType: placeholder.originalMimeType,
        status: 'failed',
        error: placeholder.error || 'Upload failed',
      })
    }
    items.push(placeholder)
  }

  const totalItems = items.length
  const completedItems = counts.complete + counts.failed
  const aggregateStatus = deriveAnalysisAggregateStatus(counts, totalItems)
  const isComplete = totalItems > 0 && completedItems === totalItems
  const percentComplete = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
  const computedCompletedAt = isComplete ? (analysis.completed_at || now.toISOString()) : null

  if (aggregateStatus !== analysis.status || String(analysis.completed_at || '') !== String(computedCompletedAt || '')) {
    await db.query(
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
    extractionDiagnostics,
  }
}
