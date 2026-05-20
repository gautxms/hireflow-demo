const isNonProductionBuild = (() => {
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV) return process.env.NODE_ENV !== 'production'
  return true
})()

function toCandidateResultsPayload(analysis) {
  const diagnostics = { fixedFieldCount: 0, fixedSkillsStructuredFieldCount: 0 }

  const normalizeString = (value, fallback = '') => {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return fallback
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return fallback
  }

  const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => normalizeString(item, '').trim())
      .filter(Boolean)
  }

  const normalizeDelimitedStringArray = (value) => {
    if (Array.isArray(value)) return normalizeStringArray(value)
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return []
  }

  const normalizeObjectArray = (value) => {
    if (!Array.isArray(value)) return []
    return value.filter((item) => item && typeof item === 'object')
  }

  const normalizeBoundedScore = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0
    return Math.max(0, Math.min(100, numeric))
  }

  const normalizeSkillsStructured = (input) => {
    const source = input && typeof input === 'object' ? input : {}
    const fields = ['tools_and_platforms', 'methodologies', 'domain_expertise', 'soft_skills']
    const normalized = {}

    for (const field of fields) {
      const rawValue = source[field]
      const normalizedValue = normalizeDelimitedStringArray(rawValue)
      if (rawValue !== undefined && JSON.stringify(normalizedValue) !== JSON.stringify(rawValue)) {
        diagnostics.fixedFieldCount += 1
        diagnostics.fixedSkillsStructuredFieldCount += 1
      }
      normalized[field] = normalizedValue
    }

    return normalized
  }

  const resolveCandidateScore = (rawCandidate) => {
    const scoreCandidates = [
      rawCandidate?.matchScore?.score,
      rawCandidate?.matchScore,
      rawCandidate?.score,
      rawCandidate?.profile_score,
      rawCandidate?.scoreBreakdown?.overall,
      rawCandidate?.overall_score,
      rawCandidate?.overallScore,
      rawCandidate?.total_score,
      rawCandidate?.totalScore,
    ]

    for (const candidateScore of scoreCandidates) {
      const numeric = Number(candidateScore)
      if (Number.isFinite(numeric)) return numeric
    }

    return 0
  }

  const normalizeCandidateForResults = (raw, index) => {
    if (!raw || typeof raw !== 'object') return null

    const id = normalizeString(raw?.id || raw?.resumeId || raw?.resume_id || `candidate-${index}`, `candidate-${index}`)
    const name = normalizeString(raw?.name || raw?.full_name || raw?.candidate_name || 'Candidate', 'Candidate')
    const normalizedScore = normalizeBoundedScore(resolveCandidateScore(raw))

    return {
      ...raw,
      id,
      name,
      title: normalizeString(raw?.title, ''),
      location: normalizeString(raw?.location, ''),
      summary: normalizeString(raw?.summary, ''),
      matchScore: normalizedScore,
      score: normalizedScore,
      resumeId: normalizeString(raw?.resumeId || raw?.resume_id, ''),
      filename: normalizeString(raw?.filename, ''),
      skills: Array.isArray(raw?.skills) || typeof raw?.skills === 'string' ? raw.skills : [],
      experience: Array.isArray(raw?.experience)
        ? normalizeObjectArray(raw?.experience)
        : normalizeString(raw?.experience, ''),
      strengths: normalizeStringArray(raw?.strengths),
      considerations: normalizeStringArray(raw?.considerations),
      mustHaveSkills: normalizeStringArray(raw?.mustHaveSkills),
      niceToHaveSkills: normalizeStringArray(raw?.niceToHaveSkills),
      missingSkills: normalizeStringArray(raw?.missingSkills),
      skills_structured: normalizeSkillsStructured(raw?.skills_structured),
      assessment: {
        summary: '',
        highlights: [],
        risks: [],
        ...(raw?.assessment && typeof raw.assessment === 'object' ? raw.assessment : {}),
      },
      scoreBreakdown: {
        overall: normalizeBoundedScore(raw?.scoreBreakdown?.overall ?? resolveCandidateScore(raw)),
        categories: {},
        ...(raw?.scoreBreakdown && typeof raw.scoreBreakdown === 'object' ? raw.scoreBreakdown : {}),
      },
    }
  }

  const safeParseResult = (value) => {
    if (!value) return null
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    return typeof value === 'object' ? value : null
  }

  const collectCandidates = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object') return []

    const candidateBuckets = [
      value.candidates,
      value.results,
      value.output,
      value.data?.candidates,
      value.data?.results,
      value.payload?.candidates,
      value.payload?.results,
      value.response?.candidates,
    ]

    for (const bucket of candidateBuckets) {
      if (Array.isArray(bucket)) {
        return bucket
      }
    }

    return []
  }

  const items = Array.isArray(analysis?.items) ? analysis.items : []
  const directCandidates = Array.isArray(analysis?.candidates) ? analysis.candidates : []

  const itemCandidates = items.flatMap((item) => {
    const normalizedCandidates = Array.isArray(item?.normalizedCandidates) ? item.normalizedCandidates : []
    if (normalizedCandidates.length > 0) {
      return normalizedCandidates
        .map((candidate, index) => {
          try {
            const normalized = normalizeCandidateForResults(candidate, index)
            if (!normalized) return null
            return {
              ...normalized,
              id: normalized.id || `${item?.resumeId || item?.id || 'candidate'}-${index}`,
              resumeId: normalizeString(item?.resumeId || normalized?.resumeId, ''),
              filename: normalizeString(item?.filename || normalized?.filename, ''),
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
    }

    const result = safeParseResult(item?.result)
    const candidates = collectCandidates(result)

    return candidates
      .map((candidate, index) => {
        try {
          const normalized = normalizeCandidateForResults(candidate, index)
          if (!normalized) return null
          return {
            ...normalized,
            id: normalized.id || `${item?.resumeId || item?.id || 'candidate'}-${index}`,
            resumeId: normalizeString(item?.resumeId || normalized?.resumeId, ''),
            filename: normalizeString(item?.filename || result?.filename || normalized?.filename, ''),
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
  })

  const rawCandidates = directCandidates.length > 0 ? directCandidates : itemCandidates
  const inputCount = rawCandidates.length
  const candidates = rawCandidates
    .map((candidate, index) => {
      try {
        return normalizeCandidateForResults(candidate, index)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      resumeId: normalizeString(candidate?.resumeId || candidate?.resume_id, ''),
      filename: normalizeString(candidate?.filename, ''),
    }))

  const outputCount = candidates.length
  const droppedCount = Math.max(0, inputCount - outputCount)
  const hasInvalidPayload = inputCount > 0 && outputCount === 0
  const hasPartiallyInvalidPayload = droppedCount > 0 && outputCount > 0

  if ((droppedCount > 0 || diagnostics.fixedFieldCount > 0) && isNonProductionBuild) {
    console.warn('[AnalysisDetailPage] Candidate normalization adjusted records.', {
      ...diagnostics,
      droppedCount,
      inputCount,
      outputCount,
      analysisId: analysis?.id || '',
    })
  }

  return {
    candidates,
    droppedCount,
    inputCount,
    outputCount,
    hasInvalidPayload,
    hasPartiallyInvalidPayload,
    normalizationDiagnostics: diagnostics,
    parseMeta: {
      ...(analysis?.parseMeta && typeof analysis.parseMeta === 'object' ? analysis.parseMeta : {}),
      analysisName: normalizeString(analysis?.name || analysis?.analysisName || analysis?.batchName, ''),
      analysisTitle: normalizeString(analysis?.name || analysis?.analysisTitle || analysis?.analysisName || analysis?.batchName, ''),
      jobTitle: normalizeString(analysis?.jobDescriptionTitle || analysis?.jobDescription?.title, ''),
      jobDescriptionTitle: normalizeString(analysis?.jobDescriptionTitle || analysis?.jobDescription?.title, ''),
      hasJobDescription: Boolean(analysis?.jobDescriptionId || analysis?.jobDescriptionTitle),
      methodUsed: analysis?.parseMeta?.methodUsed || 'ai-extraction',
    },
  }
}

export { toCandidateResultsPayload }
