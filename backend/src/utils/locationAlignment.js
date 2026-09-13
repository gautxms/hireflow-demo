const normalizeText = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')

const normalizeLocationToken = (value) => normalizeText(value)
  .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')

const WORK_MODE_TOKENS = new Set([
  'remote',
  'hybrid',
  'remote hybrid',
  'hybrid remote',
  'onsite',
  'on site',
  'on-site',
])

const LOCATION_REFERENCE_PATTERN = /\b(?:location|located|based|city|remote|hybrid|on[ -]?site|relocat(?:e|ion)|geograph(?:y|ic|ical))\b/i
const DEFINITE_LOCATION_FAILURE_PATTERN = /\b(?:location\s+mismatch|geograph(?:ic|ical)\s+mismatch|incompatible\s+location|location\s+incompatib(?:le|ility)|not\s+(?:location\s+)?eligible|does\s+not\s+meet\s+(?:the\s+)?location|fails?\s+(?:the\s+)?location|outside\s+(?:the\s+)?required\s+location|cannot\s+(?:work|commute)|unable\s+to\s+(?:work|commute)|must\s+relocate|relocation\s+required|penali[sz](?:e|ed|ing)\s+(?:the\s+)?candidate\s+for\s+location)\b/i
const ONSITE_WORK_MODE_PATTERN = /\bon[ -]?site\b/i
const FLEXIBLE_LOCATION_UNCERTAINTY_PATTERN = /\b(?:no\s+(?:indication\s+of\s+)?(?:willingness|ability)?\s*(?:or\s+ability\s+)?to\s+relocate|no\s+relocation\s+signal|no\s+relocation(?:\s+or\s+remote\s+work\s+flexibility)?\s+(?:indication|evidence|indicated)|relocation[^.!?;]{0,100}(?:not\s+(?:stated|provided)|must\s+be\s+confirmed))\b/i
const LABELED_WORK_MODE_PATTERN = /\b(?:work\s*mode|working\s+arrangement|work\s+arrangement|workplace\s+(?:mode|model|type)|work\s+setup)\b\s*(?:[:=]|-|\bis\b)?\s*(remote|hybrid|on[ -]?site)\b/i

const normalizeWorkModeValue = (value) => {
  const normalized = normalizeText(value)
  if (!normalized || normalized === 'unspecified') return null
  if (/\bhybrid\b/.test(normalized)) return 'hybrid'
  if (/\bremote\b/.test(normalized)) return 'remote'
  if (/\bon[ -]?site\b/.test(normalized)) return 'on_site'
  return null
}

const resolveLabeledWorkMode = (context = {}) => {
  for (const value of [
    context?.description,
    context?.requirements,
    context?.responsibilities,
    context?.additionalInfo,
    context?.additional_info,
    context?.fileText,
    context?.file_text,
  ]) {
    const match = normalizeText(value).replace(/[*_`]/g, '').match(LABELED_WORK_MODE_PATTERN)
    const mode = normalizeWorkModeValue(match?.[1])
    if (mode) return mode
  }
  return null
}

export function resolveJobWorkMode(context = {}) {
  // Dedicated work-mode fields are authoritative. A strongly labelled value
  // in trusted JD content comes next because the legacy employment_type field
  // has historically represented both employment type and work mode.
  const dedicatedValues = [
    context?.workMode,
    context?.work_mode,
  ]
  for (const value of dedicatedValues) {
    const mode = normalizeWorkModeValue(value)
    if (mode) return mode
  }

  const labeledMode = resolveLabeledWorkMode(context)
  if (labeledMode) return labeledMode

  const legacyValues = [
    context?.employmentType,
    context?.employment_type,
  ]
  for (const value of legacyValues) {
    const mode = normalizeWorkModeValue(value)
    if (mode) return mode
  }

  return normalizeWorkModeValue(context?.location) || 'unspecified'
}

const tokenizeJdLocations = (value) => normalizeText(value)
  .split(/\s*(?:\/|,|;|\||\bor\b|\band\b)\s*/i)
  .map(normalizeLocationToken)
  .filter((token) => token.length > 0 && !WORK_MODE_TOKENS.has(token))

const locationTokenMatches = (candidateLocation, jdLocation) => tokenizeJdLocations(jdLocation)
  .some((token) => candidateLocation === token
    || candidateLocation.startsWith(`${token},`)
    || candidateLocation.includes(` ${token} `))

export function evaluateLocationAlignment(candidate = {}, context = {}) {
  const candidateLocation = normalizeText(candidate?.location)
  const jdLocation = normalizeText(context?.location)
  const workMode = resolveJobWorkMode(context)
  const candidateAvailable = candidateLocation.length > 0
  const jdAvailable = jdLocation.length > 0 || workMode !== 'unspecified'

  const result = {
    classification: 'unknown',
    score: 50,
    candidate_location_available: candidateAvailable,
    jd_location_available: jdAvailable,
    work_mode: workMode,
  }

  if (!candidateAvailable || !jdAvailable) return result

  if (jdLocation && locationTokenMatches(candidateLocation, jdLocation)) {
    return { ...result, classification: 'match', score: 95 }
  }

  const candidateSaysRemote = /\bremote\b/.test(candidateLocation)
  if (workMode === 'remote' && candidateSaysRemote) {
    return { ...result, classification: 'remote_compatible', score: 80 }
  }

  // A remote or hybrid label does not prove that an off-list candidate can or
  // cannot satisfy geography, time-zone, commute, or relocation constraints.
  // Keep the result neutral unless the JD and resume establish compatibility.
  if (workMode === 'remote' || workMode === 'hybrid') return result

  return { ...result, classification: 'mismatch', score: 25 }
}

const splitNarrativeClauses = (value) => String(value ?? '')
  .split(/(?<!\bvs\.)(?<=[.!?])\s+|\s*;\s*/i)
  .map((entry) => entry.trim())
  .filter(Boolean)

const isDefiniteLocationFailureClause = (value, { workMode = 'unspecified' } = {}) => {
  const text = String(value ?? '')
  if (!LOCATION_REFERENCE_PATTERN.test(text)) return false
  if (DEFINITE_LOCATION_FAILURE_PATTERN.test(text)) return true

  // An AI-authored on-site requirement is itself invalid when the structured
  // JD says the role is flexible. For an off-list candidate, remove that claim
  // instead of converting it into a definite location failure.
  return (workMode === 'hybrid' || workMode === 'remote')
    && (ONSITE_WORK_MODE_PATTERN.test(text) || FLEXIBLE_LOCATION_UNCERTAINTY_PATTERN.test(text))
}

const replaceFalseOnsiteWorkMode = (value, workMode) => {
  if (typeof value !== 'string' || (workMode !== 'hybrid' && workMode !== 'remote')) return value
  const label = workMode === 'hybrid' ? 'hybrid' : 'remote'
  return value.replace(/\bon[ -]?site\b/gi, (match, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 12), offset)
    return /\bnot\s+$/i.test(prefix) ? match : label
  })
}

const reconcileNarrative = (value, { fallback = '', workMode = 'unspecified' } = {}) => {
  if (typeof value !== 'string' || !isDefiniteLocationFailureClause(value, { workMode })) return value
  const retained = splitNarrativeClauses(value)
    .filter((clause) => !isDefiniteLocationFailureClause(clause, { workMode }))
  return retained.join(' ').trim() || fallback
}

const reconcileNarrativeArray = (value, options = {}) => {
  if (!Array.isArray(value)) return value
  return value
    .map((entry) => reconcileNarrative(entry, options))
    .filter((entry) => typeof entry !== 'string' || entry.trim())
}

const mapCandidateNarrativeFields = (candidate, mapper) => {
  const stringFields = ['summary', 'summaryFull', 'recommendation', 'recommendationFull']
  const arrayFields = [
    'strengths',
    'strengthsFull',
    'matchedSkills',
    'matchedRequirementsFull',
    'missingSkills',
    'missingRequirementsFull',
    'considerations',
    'concerns',
    'risksOrGapsFull',
  ]

  for (const field of stringFields) {
    if (typeof candidate?.[field] === 'string') candidate[field] = mapper(candidate[field])
  }
  for (const field of arrayFields) {
    if (Array.isArray(candidate?.[field])) candidate[field] = candidate[field].map(mapper).filter(Boolean)
  }

  if (candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore)) {
    if (typeof candidate.matchScore.reason === 'string') candidate.matchScore.reason = mapper(candidate.matchScore.reason)
    const breakdown = candidate.matchScore.breakdown
    if (breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown)) {
      for (const key of Object.keys(breakdown)) {
        if (/location/i.test(key) && typeof breakdown[key] === 'string') breakdown[key] = mapper(breakdown[key])
      }
    }
  }

  const fit = candidate?.fit_assessment
  if (fit && typeof fit === 'object' && !Array.isArray(fit)) {
    for (const field of ['rationale']) {
      if (typeof fit[field] === 'string') fit[field] = mapper(fit[field])
    }
    for (const field of ['matched_requirements', 'missing_requirements', 'risks_or_gaps', 'notes']) {
      if (Array.isArray(fit[field])) fit[field] = fit[field].map(mapper).filter(Boolean)
    }
  }

  return candidate
}

export function reconcileCandidateLocationAlignment(candidate = {}, context = {}) {
  const alignment = evaluateLocationAlignment(candidate, context)
  if (alignment.work_mode === 'hybrid' && alignment.classification === 'match') {
    return mapCandidateNarrativeFields(structuredClone(candidate), (value) => (
      replaceFalseOnsiteWorkMode(value, alignment.work_mode)
    ))
  }

  if (alignment.classification !== 'unknown') return candidate

  const next = structuredClone(candidate)
  const narrativeOptions = { workMode: alignment.work_mode }
  const fit = next?.fit_assessment && typeof next.fit_assessment === 'object' && !Array.isArray(next.fit_assessment)
    ? next.fit_assessment
    : null

  if (fit) {
    fit.matched_requirements = reconcileNarrativeArray(fit.matched_requirements, narrativeOptions)
    fit.missing_requirements = reconcileNarrativeArray(fit.missing_requirements, narrativeOptions)
    fit.risks_or_gaps = reconcileNarrativeArray(fit.risks_or_gaps, narrativeOptions)
    fit.notes = reconcileNarrativeArray(fit.notes, narrativeOptions)
    fit.rationale = reconcileNarrative(fit.rationale, {
      fallback: 'Location compatibility is unclear from the available information.',
      ...narrativeOptions,
    })
    if (fit.location_match_score !== undefined) fit.location_match_score = null
  }

  for (const field of [
    'strengths',
    'strengthsFull',
    'matchedSkills',
    'matchedRequirementsFull',
    'missingSkills',
    'missingRequirementsFull',
    'considerations',
    'concerns',
    'risksOrGapsFull',
  ]) {
    if (Array.isArray(next[field])) next[field] = reconcileNarrativeArray(next[field], narrativeOptions)
  }
  next.recommendation = reconcileNarrative(next.recommendation, {
    fallback: 'Confirm location and work-mode compatibility during screening.',
    ...narrativeOptions,
  })
  next.recommendationFull = reconcileNarrative(next.recommendationFull, {
    fallback: 'Confirm location and work-mode compatibility during screening.',
    ...narrativeOptions,
  })

  if (next?.matchScore && typeof next.matchScore === 'object' && !Array.isArray(next.matchScore)) {
    next.matchScore.reason = reconcileNarrative(next.matchScore.reason, {
      fallback: 'Location compatibility is unclear from the available information.',
      ...narrativeOptions,
    })
    const breakdown = next.matchScore.breakdown
    if (breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown)) {
      for (const key of Object.keys(breakdown)) {
        if (/location/i.test(key) && typeof breakdown[key] === 'string') {
          breakdown[key] = reconcileNarrative(breakdown[key], {
            fallback: 'Location compatibility is unknown for the flexible work mode.',
            ...narrativeOptions,
          })
        }
      }
    }
  }

  return next
}

export function formatLocationAlignmentForPrompt(context = {}) {
  const workMode = resolveJobWorkMode(context)
  return [
    'Deterministic location semantics:',
    `- Work mode: ${workMode}`,
    '- A listed-location match is positive evidence.',
    '- For Remote or Hybrid roles, an off-list candidate location is unknown unless the JD and resume explicitly establish incompatibility; do not call it a mismatch, failure, or disqualifier.',
    '- Do not infer willingness to relocate, commute, or work remotely from a city alone.',
  ].join('\n')
}
