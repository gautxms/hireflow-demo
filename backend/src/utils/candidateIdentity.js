import crypto from 'crypto'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = String(value).trim()
  return normalized || null
}

export function isUuid(value) {
  const normalized = normalizeString(value)
  return Boolean(normalized && UUID_PATTERN.test(normalized))
}

export function resolveCandidateResumeUuid(candidate) {
  if (isUuid(candidate)) {
    return String(candidate).trim()
  }

  const source = candidate && typeof candidate === 'object' ? candidate : {}
  const possibleIds = [
    source.resumeId,
    source.resume_id,
    source.candidateId,
    source.candidate_id,
    source.id,
  ]

  for (const value of possibleIds) {
    if (isUuid(value)) {
      return String(value).trim()
    }
  }

  return null
}

function buildFallbackCandidateId(candidate, fallbackCandidateId) {
  const providedFallback = normalizeString(fallbackCandidateId)
  if (providedFallback) {
    return providedFallback
  }

  const source = candidate && typeof candidate === 'object' ? candidate : {}
  const seedParts = [
    normalizeString(source.name),
    normalizeString(source.email),
    normalizeString(source.phone),
    normalizeString(source.position),
    normalizeString(source.summary),
  ].filter(Boolean)

  const seed = seedParts.length > 0 ? seedParts.join('|').toLowerCase() : 'candidate'
  const digest = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12)
  return `candidate-${digest}`
}

export function resolveCanonicalCandidateIdentity(candidate, fallbackCandidateId = null) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  const resumeId = resolveCandidateResumeUuid(source)

  const candidateId = normalizeString(source.candidateId)
    || normalizeString(source.candidate_id)
    || normalizeString(source.id)
    || resumeId
    || buildFallbackCandidateId(source, fallbackCandidateId)

  return {
    id: candidateId,
    candidateId,
    resumeId,
  }
}
