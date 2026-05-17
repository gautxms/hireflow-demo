import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { parseQueue } from '../services/jobQueue.js'
import { resolveCanonicalParseStatus } from '../services/parseStatusMapper.js'
import { normalizeFailureCategory, normalizeParseOutcome } from '../contracts/parseResultEnums.js'

const router = Router()

const TERMINAL_STATUSES = new Set(['complete', 'failed'])

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

function normalizeItemResult(result, diagnostics) {
  const parsed = safeParseResult(result)
  if (!parsed || typeof parsed !== 'object') {
    diagnostics.invalid += 1
    return null
  }

  if (Array.isArray(parsed.candidates)) {
    diagnostics.valid += 1
    return { candidates: parsed.candidates }
  }

  if (parsed.output && typeof parsed.output === 'object' && Array.isArray(parsed.output.candidates)) {
    diagnostics.valid += 1
    return { candidates: parsed.output.candidates }
  }

  diagnostics.invalid += 1
  return null
}

function extractCandidatesFromResult(result) {
  const diagnostics = {
    parseableObject: false,
    malformed: false,
  }

  const parseStringSafely = (value) => {
    try {
      return JSON.parse(value)
    } catch {
      diagnostics.malformed = true
      return null
    }
  }

  const resolveObject = (value, depth = 0) => {
    if (depth > 4 || value == null) return null
    if (typeof value === 'string') {
      const parsed = parseStringSafely(value)
      return resolveObject(parsed, depth + 1)
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

  const candidateFields = [parsed.candidates, parsed.results, parsed.output]
  for (const field of candidateFields) {
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

function isMeaningfulScoredCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return false

  const fitStatus = String(candidate?.fitStatus || '').trim().toLowerCase()
  if (fitStatus === 'unscored') return false

  const scoreCandidates = [
    candidate?.score,
    candidate?.matchScore?.score,
    candidate?.matchScore,
    candidate?.fitScore,
    candidate?.overallFitScore,
    candidate?.profile_score,
  ]
  const finiteScores = scoreCandidates
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  const hasFiniteFitScore = finiteScores.length > 0
  const rawScore = hasFiniteFitScore ? finiteScores[0] : null
  const profileScore = candidate?.profile_score == null ? null : Number(candidate.profile_score)
  if (profileScore == null && !hasFiniteFitScore) return false
  if (rawScore != null && (rawScore < 0 || rawScore > 100)) return false

  const evidence = [
    candidate?.matchScore?.reason,
    candidate?.reasoning,
    candidate?.summary,
    candidate?.evidence,
    candidate?.scoreEvidence,
    candidate?.scoringEvidence,
  ].map((value) => String(value || '').trim()).filter(Boolean)
  if (rawScore === 0 && evidence.length === 0) return false

  const structuredSkills = Array.isArray(candidate?.skills_structured) ? candidate.skills_structured : []
  const skills = Array.isArray(candidate?.skills) ? candidate.skills : []
  const education = Array.isArray(candidate?.education) ? candidate.education : []
  if (structuredSkills.length === 0 && skills.length === 0 && education.length === 0) return false

  const experienceFields = [
    candidate?.years_experience,
    candidate?.totalExperienceYears,
    candidate?.relevantExperienceYears,
  ]
  const hasAnyExperienceValue = experienceFields.some((value) => value !== null && value !== undefined)
  if (!hasAnyExperienceValue) return false

  const failurePhrasePattern = /(parsing failed|unreadable|corrupted|manual review required|scoring deferred)/i
  const failureNarratives = [
    candidate?.summary,
    candidate?.concerns,
    candidate?.warnings,
    candidate?.matchScore?.reason,
    candidate?.reasoning,
  ].map((value) => String(value || ''))
  if (failureNarratives.some((value) => failurePhrasePattern.test(value))) return false

  const resumeProcessingStatus = String(candidate?.resumeProcessingStatus || candidate?.resume_processing_status || '').trim().toLowerCase()
  const invalidProcessingStatuses = new Set([
    'failed',
    'parse_failed',
    'parsing_failed',
    'unreadable',
    'corrupted',
    'manual_review_required',
    'manual review required',
    'scoring_deferred',
    'unscored',
    'not_scored',
    'non_scored',
    'nonscored',
  ])
  if (resumeProcessingStatus && invalidProcessingStatuses.has(resumeProcessingStatus)) return false

  return evidence.length > 0
}

function deriveAggregateStatus(counts, totalItems, extractionDiagnostics = {}) {
  if (totalItems === 0) return 'queued'

  const terminalCount = counts.complete + counts.failed
  const candidateBearingItemCount = Number(extractionDiagnostics.candidateBearingItemCount || 0)
  if (terminalCount === totalItems) {
    if (counts.complete > 0 && candidateBearingItemCount === totalItems) return 'complete'
    return 'failed'
  }

  if (counts.processing > 0 || counts.retrying > 0) {
    return 'processing'
  }

  return 'queued'
}

function buildOutcomeSummary({ total, complete, failed }) {
  const totalResumes = Number(total || 0)
  const successCount = Number(complete || 0)
  const failedCount = Number(failed || 0)
  const partialCount = Math.max(0, totalResumes - successCount - failedCount)
  return {
    totalResumes,
    successCount,
    partialCount,
    failedCount,
  }
}

function deriveResultQualityStatus(extractionDiagnostics = {}, parseTerminalComplete = false) {
  const totalItems = Number(extractionDiagnostics.totalItems || 0)
  const candidateBearingItemCount = Number(extractionDiagnostics.candidateBearingItemCount || 0)
  const missingCandidateItemCount = Math.max(0, totalItems - candidateBearingItemCount)

  const allItemsCandidateBearing = totalItems > 0 && candidateBearingItemCount === totalItems
  const partialResults = parseTerminalComplete && totalItems > 0 && candidateBearingItemCount > 0 && candidateBearingItemCount < totalItems
  const resultExtractionFailures = parseTerminalComplete && totalItems > 0 && candidateBearingItemCount === 0

  return {
    parseTerminalComplete,
    allItemsCandidateBearing,
    partialResults,
    resultExtractionFailures,
    candidateBearingItemCount,
    missingCandidateItemCount,
    qualityStatus: resultExtractionFailures ? 'missing' : (partialResults ? 'partial' : (allItemsCandidateBearing ? 'complete' : 'pending')),
  }
}

async function loadAnalysisStatus(analysisId, userId) {
  const analysisResult = await pool.query(
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
  const extractionDiagnostics = { totalItems: 0, parseableObjectCount: 0, candidateBearingItemCount: 0, malformedItemCount: 0 }
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

    const extracted = canonicalStatus === 'complete'
      ? extractCandidatesFromResult(row.parse_result)
      : { candidates: [], diagnostics: { parseableObject: false, malformed: false }, normalizedResult: null }
    extractionDiagnostics.totalItems += 1
    if (extracted.diagnostics.parseableObject) extractionDiagnostics.parseableObjectCount += 1
    if (extracted.diagnostics.malformed) extractionDiagnostics.malformedItemCount += 1
    if (extracted.candidates.some((candidate) => isMeaningfulScoredCandidate(candidate))) extractionDiagnostics.candidateBearingItemCount += 1

    const parsedResult = extracted.normalizedResult
    const scoringFailures = Array.isArray(parsedResult?.scoringFailures) ? parsedResult.scoringFailures : []
    const candidatesWithScoringFailures = Array.isArray(parsedResult?.candidatesWithScoringFailures) ? parsedResult.candidatesWithScoringFailures : []
    const implicitFailure = canonicalStatus === 'complete' && extracted.candidates.length === 0 && (scoringFailures.length > 0 || candidatesWithScoringFailures.length > 0)
    const parseOutcome = normalizeParseOutcome(implicitFailure ? 'failed' : (canonicalStatus === 'complete' ? 'success' : (canonicalStatus === 'failed' ? 'failed' : null)), 'partial')
    const failureCategory = (canonicalStatus === 'failed' || implicitFailure)
      ? normalizeFailureCategory(safeParseResult(row.parse_result)?.failureCategory || scoringFailures[0]?.reason, { fallback: 'unknown' })
      : null

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
      parseOutcome,
      failureCategory,
      result: parsedResult,
      normalizedCandidates: extracted.candidates,
      scoringFailures,
      candidatesWithScoringFailures,
    })
  }

  const totalItems = items.length
  const completedItems = counts.complete + counts.failed
  const aggregateStatus = deriveAggregateStatus(counts, totalItems, extractionDiagnostics)
  const isComplete = totalItems > 0 && completedItems === totalItems
  const parseTerminalComplete = isComplete && TERMINAL_STATUSES.has(aggregateStatus)
  const resultQuality = deriveResultQualityStatus(extractionDiagnostics, parseTerminalComplete)
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
    extractionDiagnostics,
    resultQuality,
    parseTerminalComplete,
  }
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
              r.filename,
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
        filename: row.filename || null,
        status: row.status || 'failed',
      })
      failedItemsByAnalysis.set(analysisId, existingItems)
    }

    const filesByAnalysisResult = await pool.query(
      `SELECT ai.analysis_id,
              r.filename,
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

    const extractionByAnalysisResult = await pool.query(
      `SELECT ai.analysis_id,
              COALESCE(pj.status, r.parse_status, 'queued') AS status,
              pj.result AS parse_result
       FROM analysis_items ai
       INNER JOIN analyses a ON a.id = ai.analysis_id
       LEFT JOIN resumes r ON r.id = ai.resume_id
       LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
       WHERE a.user_id = $1
       ORDER BY ai.analysis_id ASC, ai.created_at ASC`,
      [req.userId],
    )

    const extractionByAnalysis = new Map()
    for (const row of extractionByAnalysisResult.rows) {
      const analysisId = String(row.analysis_id || '')
      if (!analysisId) continue
      const existing = extractionByAnalysis.get(analysisId) || { totalItems: 0, parseableObjectCount: 0, candidateBearingItemCount: 0, malformedItemCount: 0 }
      existing.totalItems += 1
      if (row.status === 'complete') {
        const extracted = extractCandidatesFromResult(row.parse_result)
        if (extracted.diagnostics.parseableObject) existing.parseableObjectCount += 1
        if (extracted.diagnostics.malformed) existing.malformedItemCount += 1
        if (extracted.candidates.some((candidate) => isMeaningfulScoredCandidate(candidate))) existing.candidateBearingItemCount += 1
      }
      extractionByAnalysis.set(analysisId, existing)
    }

    const filesByAnalysis = new Map()
    for (const row of filesByAnalysisResult.rows) {
      const analysisId = String(row.analysis_id || '')
      if (!analysisId) continue
      const existingItems = filesByAnalysis.get(analysisId) || []
      existingItems.push({
        name: row.filename || 'Unknown file',
        status: row.status || 'queued',
      })
      filesByAnalysis.set(analysisId, existingItems)
    }

    const items = result.rows.map((row) => {
      const summary = {
        total: Number(row.total_count || 0),
        complete: Number(row.complete_count || 0),
        failed: Number(row.failed_count || 0),
        processing: Number(row.processing_count || 0),
      }
      const outcomeSummary = buildOutcomeSummary(summary)
      const parseTerminalComplete = summary.total > 0 && summary.complete + summary.failed === summary.total
      const resultQuality = deriveResultQualityStatus(extractionByAnalysis.get(String(row.id)), parseTerminalComplete)
      return {
        id: String(row.id),
        createdAt: row.created_at,
        name: row.name || null,
        status: row.status || 'queued',
        liveStatus: deriveAggregateStatus({
          queued: Math.max(0, Number(row.total_count || 0) - Number(row.complete_count || 0) - Number(row.failed_count || 0) - Number(row.processing_count || 0)),
          processing: Number(row.processing_count || 0),
          retrying: 0,
          complete: Number(row.complete_count || 0),
          failed: Number(row.failed_count || 0),
        }, Number(row.total_count || 0), extractionByAnalysis.get(String(row.id))),
        summary: {
          ...summary,
          pending: Math.max(0, summary.total - summary.complete - summary.failed - summary.processing),
          ...outcomeSummary,
          resultQuality,
        },
        failedItems: failedItemsByAnalysis.get(String(row.id)) || [],
        fileCount: summary.total,
        files: filesByAnalysis.get(String(row.id)) || [],
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

  const { analysis, aggregateStatus, counts, items, computedCompletedAt, extractionDiagnostics, resultQuality, parseTerminalComplete } = analysisData
  return res.json({
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
      ...buildOutcomeSummary({ total: items.length, complete: counts.complete, failed: counts.failed }),
      resultQuality,
    },
    jobDescriptionId: analysis.job_description_id ? String(analysis.job_description_id) : null,
    jobDescriptionTitle: analysis.job_description_title || null,
    items,
    failedResumes: aggregateStatus === 'complete' ? [] : items.filter((item) => item.parseOutcome === 'failed').map((item) => ({
      resumeId: item.resumeId || null,
      parseJobId: item.parseJobId || null,
      filename: item.filename || null,
      reason: item.error || item.scoringFailures?.[0]?.reason || 'parse_failed::unknown',
      failureCategory: item.failureCategory || 'unknown',
      resumeProcessingStatus: item.status === 'failed' ? 'parse_failed' : 'scoring_failed',
    })),
    diagnostics: {
      resultExtraction: extractionDiagnostics,
    },
    completion: {
      parseTerminalComplete,
      resultQuality,
    },
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


router.delete('/:id', requireAuth, async (req, res) => {
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
