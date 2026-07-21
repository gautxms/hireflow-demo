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

const normalizeWorkModeValue = (value) => {
  const normalized = normalizeText(value)
  if (!normalized || normalized === 'unspecified') return null
  if (/\bhybrid\b/.test(normalized)) return 'hybrid'
  if (/\bremote\b/.test(normalized)) return 'remote'
  if (/\bon[ -]?site\b/.test(normalized)) return 'on_site'
  return null
}

export function resolveJobWorkMode(context = {}) {
  const explicitValues = [
    context?.workMode,
    context?.work_mode,
    context?.employmentType,
    context?.employment_type,
  ]
  for (const value of explicitValues) {
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
  .split(/(?<=[.!?])\s+|\s*;\s*/)
  .map((entry) => entry.trim())
  .filter(Boolean)

const isDefiniteLocationFailureClause = (value) => LOCATION_REFERENCE_PATTERN.test(String(value ?? ''))
  && DEFINITE_LOCATION_FAILURE_PATTERN.test(String(value ?? ''))

const reconcileNarrative = (value, { fallback = '' } = {}) => {
  if (typeof value !== 'string' || !isDefiniteLocationFailureClause(value)) return value
  const retained = splitNarrativeClauses(value).filter((clause) => !isDefiniteLocationFailureClause(clause))
  return retained.join(' ').trim() || fallback
}

const reconcileNarrativeArray = (value) => {
  if (!Array.isArray(value)) return value
  return value
    .map((entry) => reconcileNarrative(entry))
    .filter((entry) => typeof entry !== 'string' || entry.trim())
}

export function reconcileCandidateLocationAlignment(candidate = {}, context = {}) {
  const alignment = evaluateLocationAlignment(candidate, context)
  if (alignment.classification !== 'unknown') return candidate

  const next = structuredClone(candidate)
  const fit = next?.fit_assessment && typeof next.fit_assessment === 'object' && !Array.isArray(next.fit_assessment)
    ? next.fit_assessment
    : null

  if (fit) {
    fit.missing_requirements = reconcileNarrativeArray(fit.missing_requirements)
    fit.risks_or_gaps = reconcileNarrativeArray(fit.risks_or_gaps)
    fit.notes = reconcileNarrativeArray(fit.notes)
    fit.rationale = reconcileNarrative(fit.rationale, {
      fallback: 'Location compatibility is unclear from the available information.',
    })
    if (fit.location_match_score !== undefined) fit.location_match_score = null
  }

  next.considerations = reconcileNarrativeArray(next.considerations)
  next.recommendation = reconcileNarrative(next.recommendation, {
    fallback: 'Confirm location and work-mode compatibility during screening.',
  })

  if (next?.matchScore && typeof next.matchScore === 'object' && !Array.isArray(next.matchScore)) {
    next.matchScore.reason = reconcileNarrative(next.matchScore.reason, {
      fallback: 'Location compatibility is unclear from the available information.',
    })
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
