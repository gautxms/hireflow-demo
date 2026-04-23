function toStableResumeId(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function toStableCandidateId(candidate, fallbackId) {
  const candidateId = String(candidate?.id || '').trim()
  if (candidateId) {
    return candidateId
  }
  return String(fallbackId || '').trim() || null
}

export function mergeCandidatesByResumeId(previousMap, incomingEntries) {
  const next = { ...(previousMap || {}) }
  const entries = Array.isArray(incomingEntries) ? incomingEntries : []

  entries.forEach((entry, index) => {
    const resumeId = toStableResumeId(entry?.resumeId || entry?.resume_id)
    const candidate = entry?.candidate && typeof entry.candidate === 'object' ? entry.candidate : null
    if (!candidate) {
      return
    }

    const fallbackId = resumeId || `candidate-${index + 1}`
    const stableId = resumeId || toStableCandidateId(candidate, fallbackId)
    if (!stableId) {
      return
    }

    next[stableId] = {
      ...candidate,
      id: stableId,
      resumeId: resumeId || candidate?.resumeId || candidate?.resume_id || null,
      resume_id: resumeId || candidate?.resume_id || candidate?.resumeId || null,
      sourceFilename: entry?.filename || candidate?.sourceFilename || null,
    }
  })

  return next
}

export function summarizeJobStatus(jobStatuses) {
  const statuses = Array.isArray(jobStatuses) ? jobStatuses : []
  return statuses.reduce((acc, job) => {
    const status = String(job?.status || 'pending').toLowerCase()
    acc.uploaded += 1
    if (status === 'complete') {
      acc.analyzed += 1
      return acc
    }
    if (status === 'failed') {
      acc.failed += 1
      return acc
    }
    acc.pending += 1
    return acc
  }, {
    uploaded: 0,
    analyzed: 0,
    failed: 0,
    pending: 0,
  })
}
