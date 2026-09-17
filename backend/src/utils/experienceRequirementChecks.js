export const EXPERIENCE_REQUIREMENT_CHECKS_VERSION = 'experience_requirement_checks_v1'
export const EXPERIENCE_FACTS_APPLY_VERSION = 'experience_facts_apply_v1'

const MAX_REQUIREMENTS = 12
const MAX_REQUIREMENT_LENGTH = 360

const EXPERIENCE_CONTEXT_PATTERN = /\b(?:experience|tenure|background|worked|working|role|roles|position|positions|account\s+executive|sales|engineer(?:ing)?|developer|manager|management|analyst|analysis)\b/i
const MAXIMUM_ONLY_PATTERN = /\b(?:maximum(?:\s+of)?|no\s+more\s+than|up\s+to|at\s+most)\s*$/i
const POSITIVE_REQUIREMENT_PATTERN = /\b(?:meet(?:s|ing)?|met|exceed(?:s|ed|ing)?|satisf(?:y|ies|ied|ying)|fulfil(?:l|ls|led|ling)?|above|sufficient|qualified)\b/i
const NEGATIVE_REQUIREMENT_PATTERN = /\b(?:below|fewer\s+than|less\s+than|short\s+of|shortfall|does\s+not\s+(?:meet|satisfy)|did\s+not\s+(?:meet|satisfy)|not\s+(?:the\s+)?required|fail(?:s|ed|ing)?|insufficient|underqualified|lacks?|missing|gap)\b/i
const DURATION_REFERENCE_PATTERN = /\b(?:\d+(?:\.\d+)?\s*\+?\s*(?:years?|yrs?|months?|mos?)|(?:one|two|three|four|five|six|seven|eight|nine|ten)[-\s](?:year|month)s?)\b/i
const CAREER_BACKGROUND_PATTERN = /\b(?:b2b|b2c|career|commercial|consumer|customer\s+service|employment|inbound|industry|outbound|professional|retail|saas|sales|software|technology|work)\b/i

const SUBJECT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'background', 'be', 'candidate', 'candidates', 'direct', 'essential', 'for',
  'have', 'having', 'in', 'is', 'least', 'mandatory', 'minimum', 'must', 'of', 'or', 'prior', 'proven',
  'required', 'requirement', 'requirements', 'role', 'roles', 'strong', 'the', 'to', 'with', 'within',
  'year', 'years', 'yr', 'yrs', 'month', 'months', 'mo', 'mos', 'experience', 'tenure',
])

const GENERAL_EXPERIENCE_TOKENS = new Set([
  'career', 'employment', 'overall', 'professional', 'progressive', 'total', 'work',
])

const SHARED_ALTERNATIVE_ROLE_PATTERN = /\b(account\s+executive|sales\s+(?:representative|manager)|software\s+engineer|product\s+manager)\b/i
const SALES_ROLE_PATTERN = /\b(?:account\s+executive|business\s+development\s+(?:executive|representative)|sales\s+development\s+representative|sales\s+(?:associate|coordinator|executive|manager|representative|supervisor))\b/i

function normalizeText(value, maxLength = MAX_REQUIREMENT_LENGTH) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized.slice(0, maxLength)
}

function normalizeComparable(value) {
  return normalizeText(value, 1200)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\bquota[\s-]+carrying\b/g, 'quota')
    .replace(/\baccount\s+exec(?:utive)?\b/g, 'account executive')
    .replace(/\bae\b/g, 'account executive')
    .replace(/\bsdr\b/g, 'sales development representative')
    .replace(/\bbdr\b/g, 'business development representative')
    .replace(/\b(?:closed|closes|closing)\b/g, 'close')
    .replace(/\bengineering\b/g, 'engineer')
    .replace(/\bmanagement\b/g, 'manager')
    .replace(/\bselling\b/g, 'sales')
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function meaningfulSubjectTokens(value) {
  return [...new Set(normalizeComparable(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[+.#-]+|[+.#-]+$/g, ''))
    .filter((token) => token.length > 1 && !SUBJECT_STOP_WORDS.has(token) && !/^\d+(?:\.\d+)?$/.test(token)))]
}

function monthsFromDuration(value, unit) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  const multiplier = /^y/i.test(unit) ? 12 : 1
  return Math.round(numeric * multiplier)
}

function findDurationDescriptors(value) {
  const text = normalizeText(value)
  const pattern = /\b(?:(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)|(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?|months?|mos?))\b/gi
  const descriptors = []

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    const prefix = text.slice(Math.max(0, index - 32), index)
    if (MAXIMUM_ONLY_PATTERN.test(prefix)) continue
    const requiredMonths = match[1]
      ? monthsFromDuration(match[1], match[3])
      : monthsFromDuration(match[4], match[5])
    if (requiredMonths === null) continue
    descriptors.push({
      index,
      endIndex: index + match[0].length,
      requiredMonths,
    })
  }

  return descriptors
}

function findDurationDescriptor(value) {
  return findDurationDescriptors(value)[0] || null
}

function extractSubjectSource(text, descriptor, nextDescriptor = null) {
  let suffix = text.slice(descriptor.endIndex, nextDescriptor?.index ?? text.length).trim()
    .replace(/^[’']s?\s*/, '')
    .replace(/[,;:]?\s*\b(?:and|including|with)\s+(?:(?:a\s+)?minimum\s+of\s+|at\s+least\s+)?$/i, '')
    .replace(/\b(?:required|mandatory|minimum\s+qualification|must\s+have)\b.*$/i, '')
    .replace(/[.;].*$/, '')
    .trim()

  const experienceThenSubject = suffix.match(/^(?:of\s+)?experience\s+(?:in|as|with)\s+(.+)$/i)
  if (experienceThenSubject) return experienceThenSubject[1]

  const generalExperience = suffix.match(/^(?:of\s+)?((?:(?:total|overall|professional|progressive|work)\s+)*)experience\b/i)
  if (generalExperience) return generalExperience[1].trim() || 'total professional'

  const subjectThenExperience = suffix.match(/^(?:of|in|as|with)\s+(.+?)\s+experience\b/i)
  if (subjectThenExperience) return subjectThenExperience[1]

  const afterPreposition = suffix.match(/^(?:of|in|as|with)\s+(.+)$/i)
  if (afterPreposition) return afterPreposition[1].replace(/\s+experience\b.*$/i, '')

  suffix = suffix.replace(/\s+experience\b.*$/i, '')
  return suffix
}

function isGeneralExperienceSubject(tokens) {
  return tokens.length === 0 || tokens.every((token) => GENERAL_EXPERIENCE_TOKENS.has(token))
}

function matchingSubjectTokens(value) {
  const tokens = meaningfulSubjectTokens(value)
  const specificTokens = tokens.filter((token) => !GENERAL_EXPERIENCE_TOKENS.has(token))
  return specificTokens.length > 0 ? specificTokens : tokens
}

function buildSubjectTokenGroups(subject) {
  const normalizedSubject = normalizeComparable(normalizeText(subject, 160))
  const alternatives = normalizedSubject.split(/\s+or\s+/i)
  if (alternatives.length < 2) return [matchingSubjectTokens(normalizedSubject)]

  const sharedRole = normalizedSubject.match(SHARED_ALTERNATIVE_ROLE_PATTERN)?.[1] || ''
  const sharedRoleTokens = matchingSubjectTokens(sharedRole)
  return alternatives
    .map((alternative) => [...new Set([...matchingSubjectTokens(alternative), ...sharedRoleTokens])])
    .filter((tokens) => tokens.length > 0)
}

export function extractDurationRequirements(semantics = {}) {
  const required = Array.isArray(semantics?.required) ? semantics.required : []
  const seen = new Set()
  const requirements = []

  for (const rawRequirement of required) {
    const requirementText = normalizeText(rawRequirement)
    const comparable = normalizeComparable(requirementText)
    if (!requirementText || seen.has(comparable)) continue
    seen.add(comparable)

    const descriptors = findDurationDescriptors(requirementText)
    for (const [descriptorIndex, descriptor] of descriptors.entries()) {
      const suffix = requirementText.slice(descriptor.endIndex)
      if (!EXPERIENCE_CONTEXT_PATTERN.test(requirementText) && !/^\s*(?:of|in|as|with)\b/i.test(suffix)) continue

      const subject = normalizeText(extractSubjectSource(requirementText, descriptor, descriptors[descriptorIndex + 1]), 160)
        .replace(/^(?:a|an)\s+/i, '')
        .replace(/\s+(?:role|position)$/i, '')
      const rawSubjectTokens = meaningfulSubjectTokens(subject)
      const scope = isGeneralExperienceSubject(rawSubjectTokens) ? 'total' : 'subject_specific'
      const subjectTokens = scope === 'total' ? [] : matchingSubjectTokens(subject)
      const subjectTokenGroups = scope === 'total' ? [] : buildSubjectTokenGroups(subject)
      requirements.push({
        requirement_id: `duration_requirement_${requirements.length + 1}`,
        requirement_text: requirementText,
        required_months: descriptor.requiredMonths,
        subject: scope === 'total' ? 'total professional' : subject,
        subject_tokens: subjectTokens,
        subject_token_groups: subjectTokenGroups,
        scope,
      })
      if (requirements.length >= MAX_REQUIREMENTS) break
    }
    if (requirements.length >= MAX_REQUIREMENTS) break
  }

  return requirements
}

function monthOrdinal(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || month < 1 || month > 12) return null
  return (year * 12) + month - 1
}

function unionIntervalMonths(intervals) {
  const normalized = intervals
    .map((interval) => ({ start: monthOrdinal(interval?.start_date), end: monthOrdinal(interval?.end_date) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  if (normalized.length === 0) return null

  const merged = [normalized[0]]
  for (const interval of normalized.slice(1)) {
    const current = merged[merged.length - 1]
    if (interval.start <= current.end) current.end = Math.max(current.end, interval.end)
    else merged.push(interval)
  }
  return merged.reduce((total, interval) => total + interval.end - interval.start, 0)
}

function entryMatchesSubject(entry, subjectTokenGroups) {
  if (subjectTokenGroups.length === 0) return true
  const groups = Array.isArray(subjectTokenGroups[0]) ? subjectTokenGroups : [subjectTokenGroups]
  const evidenceText = [
    entry?.title,
    entry?.description,
  ].filter(Boolean).join(' ')
  const evidenceTokens = new Set(meaningfulSubjectTokens(evidenceText))
  if (SALES_ROLE_PATTERN.test(normalizeComparable(entry?.title))) evidenceTokens.add('sales')
  else evidenceTokens.delete('sales')
  return groups.some((tokens) => tokens.every((token) => evidenceTokens.has(token)))
}

function buildRequirementCheck(requirement, candidate, factsAvailable) {
  const facts = candidate?.experience_facts_v1 || {}
  const entries = Array.isArray(candidate?.experience_entries) ? candidate.experience_entries : []
  const entryFacts = Array.isArray(facts?.entry_facts) ? facts.entry_facts : []

  if (!factsAvailable) {
    return {
      ...requirement,
      evidenced_months: null,
      evidence_entry_indexes: [],
      status: 'unknown',
      confidence: 'unavailable',
      reason_code: 'canonical_experience_facts_not_high_confidence',
    }
  }

  if (requirement.scope === 'total') {
    const evidencedMonths = Number(facts.total_months)
    return {
      ...requirement,
      evidenced_months: evidencedMonths,
      evidence_entry_indexes: entryFacts.map((entry) => entry.entry_index),
      status: evidencedMonths >= requirement.required_months ? 'met' : 'not_met',
      confidence: 'high',
      reason_code: 'deterministic_total_month_comparison',
    }
  }

  const matchedIndexes = entries
    .map((entry, index) => (entryMatchesSubject(entry, requirement.subject_token_groups) ? index : null))
    .filter((index) => index !== null)
  const matchedIntervals = entryFacts.filter((entry) => matchedIndexes.includes(entry.entry_index))
  const evidencedMonths = unionIntervalMonths(matchedIntervals)

  if (matchedIndexes.length === 0 || evidencedMonths === null) {
    return {
      ...requirement,
      evidenced_months: null,
      evidence_entry_indexes: [],
      status: 'unknown',
      confidence: 'unavailable',
      reason_code: 'insufficient_subject_evidence',
    }
  }

  return {
    ...requirement,
    evidenced_months: evidencedMonths,
    evidence_entry_indexes: matchedIndexes,
    status: evidencedMonths >= requirement.required_months ? 'met' : 'not_met',
    confidence: 'high',
    reason_code: 'deterministic_subject_month_comparison',
  }
}

export function buildExperienceRequirementChecks(candidate = {}, jobDescriptionContext = {}) {
  const requirements = extractDurationRequirements(jobDescriptionContext?.requirementSemantics)
  const facts = candidate?.experience_facts_v1 || {}
  const factsAvailable = facts?.version === 'experience_facts_v1'
    && facts?.status === 'computed'
    && facts?.confidence === 'high'
    && Number.isFinite(Number(facts?.total_months))

  if (requirements.length === 0) {
    return {
      version: EXPERIENCE_REQUIREMENT_CHECKS_VERSION,
      status: 'not_applicable',
      checks: [],
    }
  }

  return {
    version: EXPERIENCE_REQUIREMENT_CHECKS_VERSION,
    status: factsAvailable ? 'computed' : 'unavailable',
    checks: requirements.map((requirement) => buildRequirementCheck(requirement, candidate, factsAvailable)),
  }
}

function formatYears(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? String(numeric) : String(Math.round(numeric * 10) / 10)
}

function formatYearUnit(unit, value) {
  const abbreviated = /^yr/i.test(unit)
  if (Number(value) === 1) return abbreviated ? 'yr' : 'year'
  return abbreviated ? 'yrs' : 'years'
}

function formatMonths(value) {
  const numeric = Number(value)
  return `${numeric} month${numeric === 1 ? '' : 's'}`
}

function canonicalRequirementStatement(check) {
  const subject = check.scope === 'total' ? 'total professional experience' : `${check.subject} experience`
  const evidence = formatMonths(check.evidenced_months)
  const required = formatMonths(check.required_months)
  if (check.status === 'met') return `${evidence} of dated ${subject} meets the ${required} requirement.`
  return `${evidence} of dated ${subject} does not meet the ${required} requirement.`
}

function isSalesOnlyCheck(check) {
  const groups = Array.isArray(check?.subject_token_groups) && check.subject_token_groups.length > 0
    ? check.subject_token_groups
    : [check?.subject_tokens]
  return groups.length === 1
    && Array.isArray(groups[0])
    && groups[0].length === 1
    && groups[0][0] === 'sales'
}

function isQuotaCarryingAeCheck(check) {
  const groups = Array.isArray(check?.subject_token_groups) && check.subject_token_groups.length > 0
    ? check.subject_token_groups
    : [check?.subject_tokens]
  return groups.some((group) => (
    Array.isArray(group)
    && group.includes('quota')
    && group.includes('account')
    && group.includes('executive')
  ))
}

function textRelatesToCheck(value, check) {
  const text = normalizeComparable(value)
  if (!text) return false
  const quotaTenureClaim = isQuotaCarryingAeCheck(check)
    && /\bquota\b/.test(text)
    && /\b(?:experience|tenure|minimums?|requirements?|thresholds?)\b/.test(text)
  if (!DURATION_REFERENCE_PATTERN.test(text) && !quotaTenureClaim) return false
  if (check.scope === 'total') {
    return /\b(?:total|overall|professional|work)\s+(?:experience|tenure)\b/.test(text)
      || /\b(?:candidate|they|he|she)\s+(?:has|have|brings?|offers?)\s+\d+(?:\.\d+)?\s*\+?\s*(?:years?|yrs?|months?|mos?)\s+(?:of\s+)?experience\b/.test(text)
  }
  if (quotaTenureClaim) return true
  // A broad professional-sales check must not consume a distinct AE-tenure
  // requirement just because its explanation also contains the word "sales".
  if (isSalesOnlyCheck(check)
    && /\baccount executive\b/.test(text)
    && !/\bsales\s+(?:experience|tenure)\b/.test(text)) return false
  const tokens = new Set(meaningfulSubjectTokens(text))
  const groups = Array.isArray(check.subject_token_groups) && check.subject_token_groups.length > 0
    ? check.subject_token_groups
    : [check.subject_tokens]
  return groups.some((group) => group.every((token) => tokens.has(token)))
}

function splitNarrativeSentences(value) {
  const tokens = String(value || '').split(/((?:(?<!\d)\.(?!\d)|[!?;])\s*)/)
  const sentences = []
  for (let index = 0; index < tokens.length; index += 2) {
    const sentence = `${tokens[index] || ''}${tokens[index + 1] || ''}`.trim()
    if (sentence) sentences.push(sentence)
  }
  return sentences
}

function replaceQuotaThresholdClaim(sentence, check) {
  if (check?.status !== 'not_met' || !isQuotaCarryingAeCheck(check)) return null
  const statement = canonicalRequirementStatement(check).replace(/\.$/, '')
  const tenureMinimumPattern = /\bmeets?\s+years?\s+and\s+quota[\s-]+carrying\s+tenure\s+minimums?\b/i
  if (tenureMinimumPattern.test(sentence)) return sentence.replace(tenureMinimumPattern, statement)
  const coreThresholdPattern = /\b(the\s+candidate|candidate|they|he|she|[a-z][a-z.'-]*)\s+meets?\s+core\s+experience\s+thresholds\s*\([^)]*\bquota[\s-]+carrying\b[^)]*\)(?:\s+and\s+(demonstrates)\b)?/i
  if (!coreThresholdPattern.test(sentence)) return null
  return sentence.replace(coreThresholdPattern, (_match, subject, continuation) => {
    const corrected = `${subject} has ${statement.replace(' does not meet', ', which does not meet')}`
    return continuation ? `${corrected}. ${subject} ${continuation}` : corrected
  })
}

function reconcileContradictoryNarrative(value, checks) {
  if (typeof value !== 'string') return value
  const output = []
  for (const sentence of splitNarrativeSentences(value)) {
    const conflict = checks.find((check) => {
      if (!textRelatesToCheck(sentence, check)) return false
      return check.status === 'not_met'
        ? POSITIVE_REQUIREMENT_PATTERN.test(sentence)
        : NEGATIVE_REQUIREMENT_PATTERN.test(sentence)
    })
    const replacement = conflict
      ? replaceQuotaThresholdClaim(sentence, conflict) || canonicalRequirementStatement(conflict)
      : sentence
    if (!output.some((entry) => normalizeComparable(entry) === normalizeComparable(replacement))) output.push(replacement)
  }
  return output.join(' ').trim()
}

function replaceConflictingTotalYears(value, originalYears, canonicalYears) {
  if (typeof value !== 'string' || originalYears === null || canonicalYears === null || originalYears === canonicalYears) return value
  const escapedOriginal = String(originalYears).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const canonical = formatYears(canonicalYears)
  const numberPattern = Number.isInteger(originalYears) ? `${escapedOriginal}(?:\\.0)?` : escapedOriginal
  const careerStagePattern = new RegExp(
    `\\b((?:entry[-\\s]+level|early[-\\s]+career|junior|mid[-\\s]+level|senior)\\s+candidate\\s+with\\s+)${numberPattern}\\s*(years?|yrs?)\\s+of\\s+((?:(?:[a-z0-9+#.-]+)\\s+){0,8}experience)\\b`,
    'gi',
  )

  return value
    .replace(
      new RegExp(`\\b${numberPattern}\\s*\\+?\\s*(years?|yrs?)\\s+of\\s+((?:(?:total|overall|professional|work)\\s+)?experience)\\b`, 'gi'),
      (_match, unit, descriptor) => `${canonical} ${formatYearUnit(unit, canonicalYears)} of ${descriptor}`,
    )
    .replace(
      new RegExp(`\\b((?:total|overall|professional|work)\\s+(?:experience|tenure)\\s+(?:of|is|:)?\\s*)${numberPattern}\\s*(years?|yrs?)\\b`, 'gi'),
      (_match, prefix, unit) => `${prefix}${canonical} ${formatYearUnit(unit, canonicalYears)}`,
    )
    .replace(
      new RegExp(`\\b((?:candidate|they|he|she)\\s+(?:has|brings|offers)\\s+)${numberPattern}\\s*(years?|yrs?)(?=\\s+(?:of\\s+)?experience\\b)`, 'gi'),
      (_match, prefix, unit) => `${prefix}${canonical} ${formatYearUnit(unit, canonicalYears)}`,
    )
    .replace(
      new RegExp(`\\b((?:(?:significant|material|overall|total|professional)\\s+)?(?:experience|tenure)\\s+(?:gap|shortfall)\\s*:\\s*)${numberPattern}\\s*(years?|yrs?)(?=\\s*(?:actual\\s+)?(?:vs\\.?|versus|compared\\s+(?:with|to))\\s+)`, 'gi'),
      (_match, prefix, unit) => `${prefix}${canonical} ${formatYearUnit(unit, canonicalYears)}`,
    )
    .replace(careerStagePattern, (match, prefix, unit, descriptor) => (
      CAREER_BACKGROUND_PATTERN.test(descriptor)
        ? `${prefix}${canonical} ${formatYearUnit(unit, canonicalYears)} of ${descriptor}`
        : match
    ))
}

function replaceConflictingSubjectYears(value, originalYears, canonicalYears, checks, assumeExperienceContext = false) {
  if (typeof value !== 'string' || originalYears === null || canonicalYears === null || originalYears === canonicalYears) return value
  const escapedOriginal = String(originalYears).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const numberPattern = Number.isInteger(originalYears) ? `${escapedOriginal}(?:\\.0)?` : escapedOriginal
  const canonical = formatYears(canonicalYears)
  const contextualPattern = new RegExp(
    `(?<![\\d.])\\b${numberPattern}\\s*\\+?\\s*(years?|yrs?)(?=\\s+(?:of\\s+)?(?:(?:[a-z0-9+#.-]+)\\s+){0,8}experience\\b)`,
    'gi',
  )
  const barePattern = new RegExp(`(?<![\\d.])\\b${numberPattern}\\s*\\+?\\s*(years?|yrs?)\\b`, 'gi')
  const unitlessRangePattern = new RegExp(
    `^\\s*${numberPattern}\\s+(?:years?\\s+)?of\\s+(\\d+(?:\\.\\d+)?\\s*(?:[-–—]|to)\\s*\\d+(?:\\.\\d+)?)\\s*(?:years?\\s*)?(required|target|range)?(?:\\s*\\([^)]*%\\))?`,
    'i',
  )
  const statusRangePattern = new RegExp(
    `\\b(?:below|meets?|within|above|outside)\\s+(?:the\\s+)?requirement\\s*\\(\\s*${numberPattern}\\s*(?:years?\\s*)?(?:vs\\.?|versus)\\s*(\\d+(?:\\.\\d+)?\\s*(?:[-–—]|to)\\s*\\d+(?:\\.\\d+)?)\\s*(?:years?\\s*)?required\\s*\\)`,
    'i',
  )
  const withStatusRangeCorrected = assumeExperienceContext
    ? value.replace(
      statusRangePattern,
      (_match, range) => {
        const [minimum, maximum] = range.split(/\s*(?:[-–—]|to)\s*/i).map(Number)
        let label = 'Experience comparison'
        if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
          if (canonicalYears < minimum) label = 'Below requirement'
          else if (canonicalYears > maximum) label = 'Above requirement'
          else label = 'Meets requirement'
        }
        return `${label} (${canonical} years vs. ${range} years required)`
      },
    )
    : value

  return splitNarrativeSentences(withStatusRangeCorrected).map((sentence) => {
    const related = assumeExperienceContext || checks.some((check) => textRelatesToCheck(sentence, check))
    if (!related) return sentence
    const replaceCandidateDuration = (match, unit, offset, source) => {
      const previous = source.slice(Math.max(0, offset - 48), offset)
      const previousCharacter = source[offset - 1] || ''
      if (/[-–—]$/.test(previousCharacter)) return match
      if (/\b(?:at\s+least|at\s+most|minimum(?:\s+of)?|maximum(?:\s+of)?|requires?|required)\s*$/i.test(previous)) return match
      return `${canonical} ${formatYearUnit(unit, canonicalYears)}`
    }
    const contextual = sentence.replace(contextualPattern, replaceCandidateDuration)
    if (!assumeExperienceContext) return contextual
    const withUnitlessRangeCorrected = contextual.replace(
      unitlessRangePattern,
      (_match, range, qualifier) => `${canonical} years of ${range}${qualifier ? ` ${qualifier}` : ''}`,
    )
    return withUnitlessRangeCorrected.replace(barePattern, replaceCandidateDuration)
  }).join(' ').trim()
}

function currentRoleDurationMonths(candidate) {
  const entries = Array.isArray(candidate?.experience_entries) ? candidate.experience_entries : []
  const facts = Array.isArray(candidate?.experience_facts_v1?.entry_facts)
    ? candidate.experience_facts_v1.entry_facts
    : []
  const candidates = facts.filter((fact) => {
    const entryIndex = Number(fact?.entry_index)
    const entry = Number.isInteger(entryIndex) ? entries[entryIndex] : null
    return fact?.is_current === true || (entry && entry.end_date == null)
  })
  if (candidates.length !== 1) return null
  const months = Number(candidates[0]?.duration_months)
  return Number.isFinite(months) && months >= 0 ? months : null
}

function replaceConflictingCurrentRoleMonths(value, currentRoleMonths) {
  if (typeof value !== 'string' || currentRoleMonths === null) return value
  return value
    .replace(
      /\b(current\s+(?:role|position|job)\s*\(\s*)\d+(?:\.\d+)?\s*months?(\s*\))/gi,
      (_match, prefix, suffix) => `${prefix}${formatMonths(currentRoleMonths)}${suffix}`,
    )
    .replace(
      /\b((?:recent|current)\s+(?:role|position|job)\s+(?:tenure|duration)\s*\(\s*)\d+(?:\.\d+)?\s*months?(\s+(?:at|with)\s+[^)]+)?(\s*\))/gi,
      (_match, prefix, employer, suffix) => `${prefix}${formatMonths(currentRoleMonths)}${employer || ''}${suffix}`,
    )
}

function replaceNearOriginalSummaryYears(value, originalYears, canonicalYears) {
  if (typeof value !== 'string' || originalYears === null || canonicalYears === null || originalYears === canonicalYears) return value
  return value.replace(
    /\b(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)\s+of\s+experience\b/gi,
    (match, reportedValue, unit) => {
      const reportedYears = Number(reportedValue)
      if (!Number.isFinite(reportedYears) || Math.abs(reportedYears - originalYears) > 0.2) return match
      return `${formatYears(canonicalYears)} ${formatYearUnit(unit, canonicalYears)} of experience`
    },
  )
}

function reconcileNarrativeValue(value, {
  originalYears,
  canonicalYears,
  checks,
  currentRoleMonths = null,
  assumeExperienceContext = false,
  canonicalizeSummaryYears = false,
}) {
  const correctedRoleMonths = replaceConflictingCurrentRoleMonths(value, currentRoleMonths)
  const correctedSummaryYears = canonicalizeSummaryYears
    ? replaceNearOriginalSummaryYears(correctedRoleMonths, originalYears, canonicalYears)
    : correctedRoleMonths
  const correctedYears = replaceConflictingTotalYears(correctedSummaryYears, originalYears, canonicalYears)
  const correctedSubjectYears = replaceConflictingSubjectYears(
    correctedYears,
    originalYears,
    canonicalYears,
    checks,
    assumeExperienceContext,
  )
  return reconcileContradictoryNarrative(correctedSubjectYears, checks)
}

function reconcileNarrativeArray(value, options) {
  if (!Array.isArray(value)) return value
  return value
    .map((entry) => reconcileNarrativeValue(entry, options))
    .filter((entry) => typeof entry !== 'string' || entry.trim())
}

function appendUnique(values, value) {
  const list = Array.isArray(values) ? values : []
  const comparable = normalizeComparable(value)
  return list.some((entry) => normalizeComparable(entry) === comparable) ? list : [...list, value]
}

function removeRelatedRequirementEntries(values, check) {
  if (!Array.isArray(values)) return []
  return values.flatMap((entry) => {
    if (typeof entry !== 'string') return [entry]
    const retained = splitNarrativeSentences(entry).filter((sentence) => !textRelatesToCheck(sentence, check))
    const value = retained.join(' ').trim()
    return value ? [value] : []
  })
}

function reconcileRequirementArrayPair(target, matchedField, missingField, checks) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return
  if (!Array.isArray(target[matchedField]) && !Array.isArray(target[missingField])) return

  let matched = Array.isArray(target[matchedField]) ? target[matchedField] : []
  let missing = Array.isArray(target[missingField]) ? target[missingField] : []

  for (const check of checks) {
    const statement = canonicalRequirementStatement(check)
    if (check.status === 'met') {
      missing = removeRelatedRequirementEntries(missing, check)
      matched = appendUnique(removeRelatedRequirementEntries(matched, check), statement)
    } else if (check.status === 'not_met') {
      matched = removeRelatedRequirementEntries(matched, check)
      missing = appendUnique(removeRelatedRequirementEntries(missing, check), statement)
    }
  }

  target[matchedField] = matched
  target[missingField] = missing
}

function reconcileRequirementArrays(candidate, checks) {
  reconcileRequirementArrayPair(candidate, 'matchedRequirementsFull', 'missingRequirementsFull', checks)
  reconcileRequirementArrayPair(candidate, 'matchedSkills', 'missingSkills', checks)
  reconcileRequirementArrayPair(
    candidate?.fit_assessment,
    'matched_requirements',
    'missing_requirements',
    checks,
  )
}

function reconcileCandidateNarratives(candidate, { originalYears, canonicalYears, checks }) {
  const options = {
    originalYears,
    canonicalYears,
    checks,
    currentRoleMonths: currentRoleDurationMonths(candidate),
  }
  const next = structuredClone(candidate)

  for (const field of ['strengths', 'considerations', 'concerns', 'matchedRequirementsFull', 'missingRequirementsFull', 'risksOrGapsFull', 'matchedSkills', 'missingSkills']) {
    if (Array.isArray(next[field])) next[field] = reconcileNarrativeArray(next[field], options)
  }
  for (const field of ['summary', 'summaryFull', 'strengthsFull', 'recommendation', 'recommendationFull']) {
    if (typeof next[field] === 'string') {
      next[field] = reconcileNarrativeValue(next[field], {
        ...options,
        canonicalizeSummaryYears: field === 'summary' || field === 'summaryFull',
      })
    }
  }

  if (next.matchScore && typeof next.matchScore === 'object' && !Array.isArray(next.matchScore)) {
    if (typeof next.matchScore.reason === 'string') {
      next.matchScore.reason = reconcileNarrativeValue(next.matchScore.reason, options)
    }
    if (next.matchScore.breakdown && typeof next.matchScore.breakdown === 'object' && !Array.isArray(next.matchScore.breakdown)) {
      for (const [field, value] of Object.entries(next.matchScore.breakdown)) {
        if (typeof value !== 'string') continue
        next.matchScore.breakdown[field] = reconcileNarrativeValue(value, {
          ...options,
          assumeExperienceContext: /\b(?:experience|tenure|years?)\b/i.test(field.replace(/_/g, ' ')),
        })
      }
    }
  }

  if (next.fit_assessment && typeof next.fit_assessment === 'object' && !Array.isArray(next.fit_assessment)) {
    for (const field of ['matched_requirements', 'missing_requirements', 'risks_or_gaps', 'notes']) {
      if (Array.isArray(next.fit_assessment[field])) {
        next.fit_assessment[field] = reconcileNarrativeArray(next.fit_assessment[field], options)
      }
    }
    if (typeof next.fit_assessment.rationale === 'string') {
      next.fit_assessment.rationale = reconcileNarrativeValue(next.fit_assessment.rationale, options)
    }
  }

  reconcileRequirementArrays(next, checks)
  return next
}

export function applyCanonicalExperienceFactsToCandidate(candidate = {}, jobDescriptionContext = {}) {
  const facts = candidate?.experience_facts_v1 || {}
  const canonicalYears = Number(facts?.total_years)
  const eligible = facts?.version === 'experience_facts_v1'
    && facts?.status === 'computed'
    && facts?.confidence === 'high'
    && Number.isFinite(canonicalYears)
  if (!eligible) return { candidate, applied: false, skip_reason: 'canonical_facts_not_high_confidence' }

  const originalYearsValue = Number(candidate?.years_experience)
  const originalYears = Number.isFinite(originalYearsValue) ? originalYearsValue : null
  const requirementContract = buildExperienceRequirementChecks(candidate, jobDescriptionContext)
  const actionableChecks = requirementContract.checks.filter((check) => check.status === 'met' || check.status === 'not_met')
  const reconciled = reconcileCandidateNarratives(candidate, {
    originalYears,
    canonicalYears,
    checks: actionableChecks,
  })
  const counts = requirementContract.checks.reduce((result, check) => {
    result[check.status] = (result[check.status] || 0) + 1
    return result
  }, { met: 0, not_met: 0, unknown: 0 })

  return {
    candidate: {
      ...reconciled,
      years_experience: canonicalYears,
      experience_requirement_checks_v1: requirementContract,
      experience_facts_apply_metadata: {
        version: EXPERIENCE_FACTS_APPLY_VERSION,
        original_years_experience: originalYears,
        applied_years_experience: canonicalYears,
        years_delta: originalYears === null ? null : Math.round((canonicalYears - originalYears) * 10) / 10,
        duration_requirement_count: requirementContract.checks.length,
        duration_requirement_met_count: counts.met,
        duration_requirement_not_met_count: counts.not_met,
        duration_requirement_unknown_count: counts.unknown,
      },
    },
    applied: true,
    skip_reason: null,
  }
}

export const __testables = {
  canonicalRequirementStatement,
  buildSubjectTokenGroups,
  entryMatchesSubject,
  findDurationDescriptor,
  findDurationDescriptors,
  meaningfulSubjectTokens,
  reconcileContradictoryNarrative,
  replaceConflictingTotalYears,
  textRelatesToCheck,
  unionIntervalMonths,
}
