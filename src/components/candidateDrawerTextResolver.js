import { resolveActiveCandidateScore, toDisplayText } from './candidateResultsState.js'

function normalizeComparableTextKey(value) {
  return toDisplayText(value, '')
    .toLowerCase()
    .replace(/[•\-–—]/g, ' ')
    .replace(/[^a-z0-9+#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitReasoningLines(value) {
  const raw = toDisplayText(value, '')
  if (!raw) return []
  return raw
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function dedupeByComparableText(items, blocked = []) {
  const blockedKeys = new Set(blocked.map(normalizeComparableTextKey).filter(Boolean))
  const seen = new Set()
  return items.filter((item) => {
    const key = normalizeComparableTextKey(item)
    if (!key || seen.has(key) || blockedKeys.has(key)) return false
    seen.add(key)
    return true
  })
}

function firstSentence(value) {
  const [first] = splitReasoningLines(value)
  return first || ''
}

export function resolveCandidateVerdict(candidate = {}) {
  const score = resolveActiveCandidateScore(candidate)
  const title = toDisplayText(candidate?.current_title || candidate?.title, 'Candidate')
  const fitValue = toDisplayText(candidate?.matchScore?.fit || candidate?.fit_assessment?.fit || candidate?.fit_assessment?.verdict || candidate?.verdict, '')
  const summarySentence = firstSentence(candidate?.summary)

  if (summarySentence) return summarySentence
  if (fitValue) return `${title}: ${fitValue}.`
  if (score != null && score >= 80) return `${title} appears to be a strong match for the role requirements.`
  if (score != null && score >= 60) return `${title} appears to be a potential match pending recruiter validation.`
  if (score != null) return `${title} shows limited alignment with the role based on current profile data.`
  return `${title} requires recruiter review due to limited structured fit data.`
}

export function resolveCandidateReasoning(candidate = {}, verdict = '') {
  const lines = dedupeByComparableText([
    ...splitReasoningLines(candidate?.matchScore?.reason),
    ...splitReasoningLines(candidate?.fit_assessment?.reason),
    ...splitReasoningLines(candidate?.summary),
  ], [verdict])

  if (lines.length === 0) {
    return 'Reasoning unavailable for this profile.'
  }

  return lines.join(' ')
}

export { dedupeByComparableText, normalizeComparableTextKey }
