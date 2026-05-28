export function appendShortlist(shortlists, shortlist) {
  return [shortlist, ...shortlists.filter((item) => item.id !== shortlist.id)]
}

export function removeShortlistCandidate(shortlistDetails, resumeId) {
  return {
    ...shortlistDetails,
    candidates: (shortlistDetails?.candidates || []).filter((candidate) => candidate.resume_id !== resumeId),
  }
}

export function getDecisionStatus(candidate) {
  const raw = candidate?.decision_status
    || candidate?.candidate_snapshot?.decision_status
    || candidate?.candidate_snapshot?.decisionStatus
  return raw ? String(raw) : 'Unspecified'
}

export function getAnalysisSource(candidate) {
  const raw = candidate?.analysis_source
    || candidate?.candidate_snapshot?.analysis_source
    || candidate?.candidate_snapshot?.analysisSource
    || candidate?.candidate_snapshot?.source

  if (raw) {
    return String(raw)
  }

  if (candidate?.analysis_id) {
    return 'Linked analysis'
  }

  return 'Legacy / Unknown'
}

export function getRatingValue(candidate) {
  const value = Number(candidate?.rating)
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(5, Math.round(value))) : null
}

function normalizeScoreToTenPoint(rawScore) {
  const numeric = Number(rawScore)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  const normalized = numeric > 10 ? numeric / 10 : numeric
  return Math.max(0, Math.min(10, normalized))
}

function firstValidScore(candidates = []) {
  for (const value of candidates) {
    const normalized = normalizeScoreToTenPoint(value)
    if (normalized !== null) return normalized
  }
  return null
}

export function getShortlistCandidateScore(candidate = {}) {
  const snapshot = candidate?.candidate_snapshot && typeof candidate.candidate_snapshot === 'object' ? candidate.candidate_snapshot : {}
  const sourceContext = candidate?.source_context && typeof candidate.source_context === 'object' ? candidate.source_context : {}

  const analysisScore = firstValidScore([
    snapshot?.score,
    snapshot?.matchScore?.score,
    snapshot?.matchScore,
    snapshot?.overallScore,
    snapshot?.aiScore,
    sourceContext?.score,
    sourceContext?.matchScore?.score,
    sourceContext?.matchScore,
    sourceContext?.overallScore,
    candidate?.score,
  ])
  if (analysisScore !== null) return { value: analysisScore, source: 'analysis' }

  const legacyRating = firstValidScore([candidate?.rating])
  if (legacyRating !== null) return { value: legacyRating, source: 'legacy_rating' }

  return null
}

export function formatShortlistCandidateScore(candidate = {}) {
  const resolved = getShortlistCandidateScore(candidate)
  if (!resolved) {
    return { label: 'Score unavailable', tone: 'muted' }
  }

  return { label: `Score: ${resolved.value.toFixed(1)}/10`, tone: 'default' }
}


function resolveShortlistAnalysisId(candidate = {}) {
  const sourceContext = candidate?.source_context && typeof candidate.source_context === 'object' ? candidate.source_context : {}
  const snapshot = candidate?.candidate_snapshot && typeof candidate.candidate_snapshot === 'object' ? candidate.candidate_snapshot : {}
  const candidates = [
    candidate?.analysis_id,
    candidate?.analysisId,
    sourceContext?.analysisId,
    sourceContext?.analysis_id,
    snapshot?.sourceAnalysisId,
    snapshot?.analysisId,
    snapshot?.analysis_id,
  ]

  for (const value of candidates) {
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }

  return ''
}

export function getShortlistAnalysisHref(candidate = {}) {
  const analysisId = resolveShortlistAnalysisId(candidate)
  return analysisId ? `/analyses/${encodeURIComponent(analysisId)}` : ''
}

export function filterShortlistCandidates(candidates, filters = {}) {
  const decisionStatus = filters.decisionStatus || 'all'
  const rating = filters.rating || 'all'
  const analysisSource = filters.analysisSource || 'all'

  return (candidates || []).filter((candidate) => {
    const matchesDecision = decisionStatus === 'all' || getDecisionStatus(candidate) === decisionStatus
    const matchesAnalysis = analysisSource === 'all' || getAnalysisSource(candidate) === analysisSource

    let matchesRating = true
    if (rating === 'rated') {
      matchesRating = getRatingValue(candidate) !== null
    } else if (rating === 'unrated') {
      matchesRating = getRatingValue(candidate) === null
    } else if (rating !== 'all') {
      matchesRating = getRatingValue(candidate) === Number(rating)
    }

    return matchesDecision && matchesAnalysis && matchesRating
  })
}

export function createShortlistExportRows(candidates = []) {
  return candidates.map((candidate) => ({
    resume_id: candidate.resume_id,
    filename: candidate.filename || candidate.resume_id || 'Unnamed candidate',
    rating: getRatingValue(candidate) ?? '',
    decision_status: getDecisionStatus(candidate),
    analysis_source: getAnalysisSource(candidate),
    notes: candidate.notes || '',
    added_at: candidate.added_at || '',
  }))
}

export function buildShortlistSummary(summary = {}, mode = 'add') {
  const added = Number(summary.added || 0)
  const updated = Number(summary.updated || 0) + Number(summary.notPresent || 0)
  const failed = Number(summary.failed || 0) + Number(summary.invalid || 0)

  if (mode === 'remove') {
    return `Added: 0 · Updated: ${updated + Number(summary.removed || 0)} · Failed: ${failed}`
  }

  return `Added: ${added} · Updated: ${updated} · Failed: ${failed}`
}

export function getShortlistBulkErrorMessage(errorPayload = {}) {
  const errorCode = String(errorPayload?.errorCode || '').trim()

  if (errorCode === 'permission_error') {
    return 'You don’t have permission to update this shortlist. Ask a workspace admin for access, then try again.'
  }

  if (errorCode === 'missing_shortlist') {
    return 'This shortlist is no longer available. Select another shortlist or create a new one to continue.'
  }

  if (errorCode === 'stale_selection') {
    return 'Your selection is out of date. Refresh the list, review highlighted candidates, and submit again.'
  }

  if (errorCode === 'partial_failure') {
    return 'Some candidates could not be processed. Retry failed items.'
  }

  return String(errorPayload?.error || '').trim()
}

export function buildShortlistExportFilename(shortlistName, ext) {
  const safeName = String(shortlistName || 'shortlist')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${safeName || 'shortlist'}-${timestamp}.${ext}`
}


export function getCandidateJobContext(candidate) {
  const context = candidate?.source_context && typeof candidate.source_context === 'object' ? candidate.source_context : {}
  const snapshotJob = candidate?.candidate_snapshot?.associatedJob || {}
  const jobId = String(context.jobDescriptionId || context.sourceJobId || snapshotJob.id || '').trim()
  const jobTitle = String(context.jobTitle || snapshotJob.title || '').trim()

  if (jobTitle && jobId) return `${jobTitle} (${jobId})`
  if (jobTitle) return jobTitle
  if (jobId) return `Job ${jobId}`
  return 'General shortlist'
}


export function getShortlistJobLabel(shortlist) {
  const jobLabel = String(shortlist?.job_label || '').trim()
  if (jobLabel) return jobLabel
  if (shortlist?.job_description_id) return `Job ${shortlist.job_description_id}`
  return 'General shortlist'
}

export function hasShortlistLinkedJob(shortlist) {
  return Boolean(String(shortlist?.job_label || '').trim() || shortlist?.job_description_id)
}
