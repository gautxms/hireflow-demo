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
