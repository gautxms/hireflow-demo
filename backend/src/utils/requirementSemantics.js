const PREFERRED_MARKER = /\b(?:preferred|nice[ -]to[ -]have|good[ -]to[ -]have|bonus|desirable|advantage(?:ous)?|optional|a plus|plus point)\b/i
const REQUIRED_MARKER = /\b(?:required|mandatory|must(?:\s+have)?|minimum qualifications?|essential|need(?:ed)?|should have)\b/i
const PREFERRED_HEADING = /^(?:preferred qualifications?|preferred skills?|preferred|nice[ -]to[ -]have|good[ -]to[ -]have|bonus|desirable)\s*:?\s*/i
const REQUIRED_HEADING = /^(?:required qualifications?|required skills?|required|minimum qualifications?|must[ -]haves?|requirements?|qualifications?)\s*:?\s*/i
const BULLET_PREFIX = /^\s*(?:[-*•▪◦]|\d+[.)])\s*/
const MAX_REQUIRED_CLAUSES = 40
const MAX_PREFERRED_CLAUSES = 25
const MAX_CLAUSE_LENGTH = 360

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'at', 'be', 'but', 'by', 'candidate', 'candidates', 'desirable', 'either',
  'documented', 'evidence', 'experience', 'experienced', 'familiarity', 'for', 'gap', 'good', 'have', 'having',
  'in', 'is', 'it', 'knowledge', 'lacks', 'mentioned', 'missing', 'must', 'nice', 'no', 'not', 'of', 'one',
  'optional', 'or', 'plus', 'preferred', 'proficiency', 'required',
  'requirement', 'requirements', 'should', 'skill', 'skills', 'strong', 'the', 'to', 'using', 'with', 'years',
])

const normalizeWhitespace = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

const normalizeComparable = (value) => normalizeWhitespace(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\bnode\s*\.\s*js\b|\bnodejs\b/g, 'node js')
  .replace(/\bnext\s*\.\s*js\b|\bnextjs\b/g, 'next js')
  .replace(/\bvue\s*\.\s*js\b|\bvuejs\b/g, 'vue js')
  .replace(/\bc\s*\+\s*\+\b/g, 'cpp')
  .replace(/\bc\s*#/g, 'csharp')
  .replace(/\.net\b|\bdot\s+net\b/g, 'dotnet')
  .replace(/[^a-z0-9+#.\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const meaningfulTokens = (value) => normalizeComparable(value)
  .split(/\s+/)
  .map((token) => token.replace(/^[+.#-]+|[+.#-]+$/g, ''))
  .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !/^\d+(?:\.\d+)?$/.test(token))

const uniqueStrings = (values) => [...new Set(values.map(normalizeWhitespace).filter(Boolean))]

const boundedStatements = (values, maxItems) => uniqueStrings(values)
  .map((value) => value.slice(0, MAX_CLAUSE_LENGTH).trim())
  .filter(Boolean)
  .slice(0, maxItems)

const uniqueSemanticStrings = (values) => uniqueStrings(values)
  .sort((first, second) => second.length - first.length)
  .filter((value, index, sorted) => {
    const tokens = meaningfulTokens(value)
    return !sorted.slice(0, index).some((existing) => {
      const existingTokens = new Set(meaningfulTokens(existing))
      return tokens.length > 0 && tokens.every((token) => existingTokens.has(token))
    })
  })

function splitStatements(value) {
  const source = String(value ?? '').replace(/\r/g, '\n')
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  return lines.flatMap((line) => line
    .replace(BULLET_PREFIX, '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(normalizeWhitespace)
    .filter(Boolean))
}

function classifyText(value, { defaultKind = 'neutral' } = {}) {
  const required = []
  const preferred = []
  let sectionKind = defaultKind

  for (const rawStatement of splitStatements(value)) {
    if (PREFERRED_HEADING.test(rawStatement)) {
      sectionKind = 'preferred'
      const remainder = rawStatement.replace(PREFERRED_HEADING, '').trim()
      if (remainder) preferred.push(remainder)
      continue
    }
    if (REQUIRED_HEADING.test(rawStatement)) {
      sectionKind = 'required'
      const remainder = rawStatement.replace(REQUIRED_HEADING, '').trim()
      if (remainder) required.push(remainder)
      continue
    }

    if (PREFERRED_MARKER.test(rawStatement)) preferred.push(rawStatement)
    else if (REQUIRED_MARKER.test(rawStatement) || sectionKind === 'required') required.push(rawStatement)
    else if (sectionKind === 'preferred') preferred.push(rawStatement)
  }

  return { required, preferred }
}

function cleanAlternativeOption(value) {
  return normalizeWhitespace(value)
    .replace(BULLET_PREFIX, '')
    .replace(/^(?:or|either|one\s+of|any\s+of|at\s+least\s+one\s+of|such\s+as)\s+/i, '')
    .replace(/^(?:strong\s+)?(?:experience|proficiency|knowledge|familiarity|skills?)\s+(?:with|in|of)\s+/i, '')
    .replace(/\b(?:is|are)\s+(?:required|preferred|desirable|a\s+plus)\b.*$/i, '')
    .replace(/[().:;]+$/g, '')
    .trim()
}

function extractAlternativeGroupsFromStatement(statement) {
  const source = normalizeWhitespace(statement)
  if (!source) return []

  const parentheticalSegments = [...source.matchAll(/\(([^()]+)\)/g)]
    .map((match) => match[1])
    .filter((segment) => /\bor\b|\//i.test(segment))
  const segments = parentheticalSegments.length > 0 ? parentheticalSegments : [source]
  const groups = []

  for (let segment of segments) {
    if (!/\bor\b/i.test(segment) && !/(?:[A-Za-z0-9+#.]+\s*\/\s*){2,}[A-Za-z0-9+#.]+/.test(segment)) continue
    segment = segment
      .replace(/\s+(?:and|plus)\s+[^,;]+$/i, '')
      .replace(/^(?:.*?\b(?:either|one\s+of|any\s+of|at\s+least\s+one\s+of)\b\s*:?)\s*/i, '')

    const options = segment
      .split(/\s*,\s*|\s+or\s+|\s*\/\s*/i)
      .map(cleanAlternativeOption)
      .filter((option) => {
        const tokens = meaningfulTokens(option)
        return tokens.length > 0 && tokens.length <= 6 && option.length <= 80
      })

    const uniqueOptions = uniqueStrings(options)
    if (uniqueOptions.length >= 2 && uniqueOptions.length <= 8) groups.push(uniqueOptions)
  }

  return groups
}

function optionAppearsInText(option, text) {
  const optionTokens = meaningfulTokens(option)
  if (optionTokens.length === 0) return false
  const textTokens = new Set(meaningfulTokens(text))
  return optionTokens.every((token) => textTokens.has(token))
}

function statementMatchesText(statement, text) {
  const statementTokens = meaningfulTokens(statement)
  const textTokens = new Set(meaningfulTokens(text))
  if (statementTokens.length === 0 || textTokens.size === 0) return false
  const overlap = statementTokens.filter((token) => textTokens.has(token)).length
  return overlap >= Math.min(2, statementTokens.length, textTokens.size)
}

export function buildRequirementSemantics(context = {}) {
  const required = []
  const preferred = []

  const requirementText = classifyText(context.requirements, { defaultKind: 'required' })
  required.push(...requirementText.required)
  preferred.push(...requirementText.preferred)

  for (const value of [context.description, context.additionalInfo, context.fileText]) {
    const classified = classifyText(value, { defaultKind: 'neutral' })
    required.push(...classified.required)
    preferred.push(...classified.preferred)
  }

  required.push(...(Array.isArray(context.skills) ? context.skills : []))

  const normalizedRequired = boundedStatements(required, MAX_REQUIRED_CLAUSES)
  const normalizedPreferred = boundedStatements(preferred, MAX_PREFERRED_CLAUSES)
    .filter((statement) => !normalizedRequired.some((requiredStatement) => statementMatchesText(requiredStatement, statement)))
  const alternativeGroups = uniqueStrings([...normalizedRequired, ...normalizedPreferred])
    .flatMap(extractAlternativeGroupsFromStatement)
    .filter((group, index, groups) => groups.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(group)) === index)

  return {
    version: 'jd_requirement_semantics_v1',
    required: normalizedRequired,
    preferred: normalizedPreferred,
    alternativeGroups,
  }
}

export function formatRequirementSemanticsForPrompt(semantics = {}) {
  const required = Array.isArray(semantics.required) ? semantics.required : []
  const preferred = Array.isArray(semantics.preferred) ? semantics.preferred : []
  const groups = Array.isArray(semantics.alternativeGroups) ? semantics.alternativeGroups : []
  return [
    'Deterministic requirement semantics:',
    `- Required/core clauses: ${required.length > 0 ? required.join(' | ') : 'Not explicitly separated'}`,
    `- Preferred/bonus clauses: ${preferred.length > 0 ? preferred.join(' | ') : 'None explicitly identified'}`,
    `- Alternative groups (satisfying any one option satisfies the group): ${groups.length > 0 ? groups.map((group) => `[${group.join(' OR ')}]`).join(' | ') : 'None explicitly identified'}`,
    '- Do not report an unselected alternative as a missing requirement when another option in its group is evidenced.',
    '- Preferred clauses may be noted as preferred gaps, but must not be described or scored as mandatory core failures.',
  ].join('\n')
}

function candidatePositiveEvidence(candidate = {}) {
  const fit = candidate?.fit_assessment && typeof candidate.fit_assessment === 'object' ? candidate.fit_assessment : {}
  const values = [
    ...(Array.isArray(fit.matched_requirements) ? fit.matched_requirements : []),
    ...(Array.isArray(candidate.matchedSkills) ? candidate.matchedSkills : []),
    ...(Array.isArray(candidate.skills_flat) ? candidate.skills_flat : []),
    ...(Array.isArray(candidate.top_skills) ? candidate.top_skills : []),
    candidate.skills_structured,
    candidate.skills,
    candidate.experience,
    candidate.projects,
  ]
  const flatten = (value) => {
    if (Array.isArray(value)) return value.flatMap(flatten)
    if (value && typeof value === 'object') return Object.values(value).flatMap(flatten)
    return value === null || value === undefined ? [] : [String(value)]
  }
  return flatten(values).join(' ')
}

function findCoveredAlternativeGroups(semantics, positiveText) {
  return (Array.isArray(semantics?.alternativeGroups) ? semantics.alternativeGroups : [])
    .filter((group) => group.some((option) => optionAppearsInText(option, positiveText)))
}

function classifyMissingEntry(entry, semantics, coveredGroups) {
  const text = normalizeWhitespace(entry)
  if (!text) return { disposition: 'keep', text }

  const requiredMatch = (semantics.required || []).some((statement) => statementMatchesText(statement, text))
  const preferredMatch = (semantics.preferred || []).some((statement) => statementMatchesText(statement, text))
  const coveredAlternative = coveredGroups.find((group) => group.some((option) => optionAppearsInText(option, text)))
  if (coveredAlternative) {
    const requiredOutsideGroup = (semantics.required || []).some((statement) => {
      if (!statementMatchesText(statement, text)) return false
      return !coveredAlternative.some((option) => optionAppearsInText(option, statement))
    })
    if (!requiredOutsideGroup) return { disposition: 'satisfied_alternative', text }
  }

  if (preferredMatch && !requiredMatch) return { disposition: 'preferred', text }

  return { disposition: 'keep', text }
}

export function reconcileCandidateRequirementSemantics(candidate = {}, semantics = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
  const normalizedSemantics = {
    required: Array.isArray(semantics.required) ? semantics.required : [],
    preferred: Array.isArray(semantics.preferred) ? semantics.preferred : [],
    alternativeGroups: Array.isArray(semantics.alternativeGroups) ? semantics.alternativeGroups : [],
  }
  if (normalizedSemantics.preferred.length === 0 && normalizedSemantics.alternativeGroups.length === 0) return candidate

  const positiveText = candidatePositiveEvidence(candidate)
  const coveredGroups = findCoveredAlternativeGroups(normalizedSemantics, positiveText)
  const preferredGaps = []
  const reconcileArray = (values) => {
    if (!Array.isArray(values)) return values
    return values.flatMap((entry) => {
      if (typeof entry !== 'string') return [entry]
      const clauses = entry
        .split(/(?:;|(?<=[.!?])\s+|,\s+(?=(?:but|however|while|whereas)\b))/i)
        .map((clause) => clause.trim().replace(/^(?:but|however|while|whereas)\s+/i, ''))
        .filter(Boolean)
      const classified = clauses.map((clause) => classifyMissingEntry(clause, normalizedSemantics, coveredGroups))
      if (classified.every(({ disposition }) => disposition === 'keep')) return [entry]
      for (const result of classified) {
        if (result.disposition === 'preferred') preferredGaps.push(result.text)
      }
      return classified.filter(({ disposition }) => disposition === 'keep').map(({ text }) => text)
    })
  }

  const fit = candidate.fit_assessment && typeof candidate.fit_assessment === 'object'
    ? candidate.fit_assessment
    : null
  const existingPreferred = [
    ...(Array.isArray(candidate.preferredGaps) ? candidate.preferredGaps : []),
    ...(Array.isArray(fit?.preferred_gaps) ? fit.preferred_gaps : []),
  ]
  const nextFit = fit ? {
    ...fit,
    missing_requirements: reconcileArray(fit.missing_requirements),
  } : fit
  const nextCandidate = {
    ...candidate,
    missingSkills: reconcileArray(candidate.missingSkills),
    missingRequirementsFull: reconcileArray(candidate.missingRequirementsFull),
    fit_assessment: nextFit,
  }
  const allPreferredGaps = uniqueSemanticStrings([...existingPreferred, ...preferredGaps])
  if (allPreferredGaps.length > 0) {
    nextCandidate.preferredGaps = allPreferredGaps
    if (nextFit) nextCandidate.fit_assessment = { ...nextFit, preferred_gaps: allPreferredGaps }
  }
  return nextCandidate
}

export const __testables = {
  meaningfulTokens,
  classifyText,
  extractAlternativeGroupsFromStatement,
  optionAppearsInText,
  statementMatchesText,
  classifyMissingEntry,
}
