const CONTRACT_VERSION = 'deterministic_jd_fit_v1'
const STRONG_STRUCTURED_FINAL_FLOOR = 86
const STRONG_STRUCTURED_FINAL_CEILING = 91

const WEIGHTS = Object.freeze({
  requirement_match: 0.4,
  skill_alignment: 0.25,
  experience_alignment: 0.15,
  location_alignment: 0.05,
  evidence_completeness: 0.1,
  profile_prior: 0.05,
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const roundScore = (value) => Math.round(clamp(value, 0, 100) * 10) / 10
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])
const present = (value) => value !== null && value !== undefined && String(value).trim() !== ''
const normalizeEvidenceText = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[–—]/g, '-')
  .replace(/[^a-z0-9.+#\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const withSemanticLanguageTokens = (value) => normalizeEvidenceText(value)
  .replace(/(^|[^a-z0-9])c\s*\+\s*\+([^a-z0-9]|$)/g, ' cpp ')
  .replace(/(^|[^a-z0-9])c\s*#([^a-z0-9]|$)/g, ' csharp ')
  .replace(/(^|[^a-z0-9])f\s*#([^a-z0-9]|$)/g, ' fsharp ')
  .replace(/\b\.\s*net\b|\bdot\s+net\b/g, ' dotnet ')
  .replace(/\bnode\s*\.\s*js\b|\bnodejs\b/g, ' nodejs ')
  .replace(/\bvue\s*\.\s*js\b|\bvuejs\b/g, ' vuejs ')
  .replace(/\bnext\s*\.\s*js\b|\bnextjs\b/g, ' nextjs ')

const normalizeEvidenceConceptText = (value) => withSemanticLanguageTokens(value)
  .replace(/[.+#-]/g, ' ')
  .replace(/\b(?:with|and|or|the|a|an|for|to|of|in|on|at|required|requirement|requirements|skill|skills|evidence|candidate|has|have|having|no|not|without|missing|minimum|target|strong|good|solid|basic|basics|exposure|ownership|knowledge|hands|on)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const canonicalEvidenceText = (value) => normalizeEvidenceConceptText(value)
  .split(' ')
  .filter(Boolean)
  .sort()
  .join(' ')

const uniqueNormalized = (values) => [...new Set(asArray(values).map(canonicalEvidenceText).filter(Boolean))]

const safeOpaqueBucketKey = (value) => {
  const source = String(value ?? '')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `other_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

const REQUIREMENT_CONCEPT_BUCKETS = Object.freeze([
  ['language_cpp', /\bcpp\b|(^|[^a-z0-9])c\s*\+\s*\+([^a-z0-9]|$)/i],
  ['language_csharp', /\bcsharp\b|(^|[^a-z0-9])c\s*#([^a-z0-9]|$)/i],
  ['language_c', /\bc\b/i],
  ['language_fsharp', /\bfsharp\b|(^|[^a-z0-9])f\s*#([^a-z0-9]|$)/i],
  ['dotnet', /\bdotnet\b|\b\.\s*net\b|\bdot\s+net\b/i],
  ['typescript_javascript_node', /\b(?:typescript|javascript|node\s*js|nodejs|node)\b/i],
  ['frontend_js_framework', /\b(?:react|vue\s*js|vuejs|vue|next\s*js|nextjs)\b/i],
  ['experience_years', /\b(?:\d+(?:\.\d+)?\s*(?:\+\s*)?(?:years?|yrs?)|professional\s+experience|work\s+experience|relevant\s+experience|production\s+experience|early\s+career|junior\s+profile|experience\s+gap)\b/i],
  ['cloud_platforms', /\b(?:cloud|aws|azure|gcp|google\s+cloud|kubernetes|k8s|docker|container|containers|deployment|devops)\b/i],
  ['testing_ci', /\b(?:test|testing|unit\s+test|integration\s+test|automation|qa|quality\s+assurance|ci\s*cd|cicd|pipeline|pipelines)\b/i],
  ['system_design', /\b(?:system\s+design|scalability|scalable|distributed\s+systems?|architecture|architectural|microservices?)\b/i],
  ['async_background', /\b(?:async|asynchronous|queue|queues|background\s+jobs?|workers?|caching|cache|redis|messaging|event\s+driven)\b/i],
  ['auth_security', /\b(?:auth|authentication|authorization|rbac|oauth|jwt|secure\s+api|security|permissions?)\b/i],
  ['backend_framework', /\b(?:backend\s+framework|flask|express|django|fastapi|nestjs?|nest\s+js|spring\s+boot|rails|laravel)\b/i],
  ['backend_api', /\b(?:backend|api|apis|rest|graphql|services?|server\s+side)\b/i],
  ['database_sql', /\b(?:sql|postgres|postgresql|mysql|database|databases|mongodb|mongo|nosql)\b/i],
])

const requirementConceptKey = (value) => {
  const normalized = withSemanticLanguageTokens(value)
  if (!normalized) return ''
  for (const [bucket, pattern] of REQUIREMENT_CONCEPT_BUCKETS) {
    if (pattern.test(normalized)) return bucket
  }
  return safeOpaqueBucketKey(canonicalEvidenceText(normalized))
}

const WEAK_EVIDENCE_PATTERN = /\b(?:basic|basics|beginner|exposure|familiar|familiarity|manual|internal\s+tools?|toy|demo|academic)\b/i
const DEPTH_GAP_PATTERN = /\b(?:production|depth|maturity|mature|scale|scalable|advanced|strong|hands\s+on|architecture|architectural|cloud\s+platform|aws|gcp|azure|kubernetes|k8s|ci\s*cd|cicd|integration\s+test|auth|authentication|authorization|rbac|async|queue|queues|background\s+jobs?)\b/i
const STRONG_COVERAGE_PATTERN = /\b(?:production|depth|maturity|mature|scale|scalable|advanced|strong|hands\s+on|architecture|architectural|aws|gcp|azure|kubernetes|k8s|ci\s*cd|cicd|integration\s+test|auth|authentication|authorization|rbac|async|queue|queues|background\s+jobs?)\b/i

const requirementConceptEvidence = (value) => {
  const normalized = normalizeEvidenceText(value)
  const canonical = canonicalEvidenceText(normalized)
  return {
    bucket: requirementConceptKey(normalized),
    canonical,
    weak: WEAK_EVIDENCE_PATTERN.test(normalized),
    depthGap: DEPTH_GAP_PATTERN.test(normalized),
    strongCoverage: STRONG_COVERAGE_PATTERN.test(normalized) && !WEAK_EVIDENCE_PATTERN.test(normalized),
  }
}

const missingEvidenceCoveredByMatch = (missing, matched) => {
  if (!missing.bucket || missing.bucket !== matched.bucket) return false
  if (missing.canonical && missing.canonical === matched.canonical) return true
  if (!missing.depthGap) return true
  return matched.strongCoverage && !matched.weak
}

const STRUCTURED_STRONG_COVERAGE_PATTERN = /\b(?:production|depth|ownership|owned|implementation|implemented|built|delivered|deployed|deployment|rollout|pipeline|infrastructure|secure\s+api|scalable|scale|architecture|architectural)\b/i

const structuredConceptEvidence = (value, bucket, source = 'rich_structured') => {
  const evidence = requirementConceptEvidence(value)
  const hasStructuredDepthSignal = STRUCTURED_STRONG_COVERAGE_PATTERN.test(String(value ?? ''))
  return {
    ...evidence,
    bucket,
    strongCoverage: !hasStructuredDepthSignal
      ? false
      : evidence.strongCoverage,
    source,
    structured: true,
  }
}

const normalizedRequirementEvidence = (matchedValues, missingValues, structuredMatchedEvidence = []) => {
  const comparisonBuckets = new Set([
    ...asArray(matchedValues).map(requirementConceptEvidence),
    ...asArray(missingValues).map(requirementConceptEvidence),
  ].map((evidence) => evidence.bucket).filter(Boolean))
  const eligibleStructuredEvidence = asArray(structuredMatchedEvidence)
    .filter((evidence) => evidence.bucket && comparisonBuckets.has(evidence.bucket))
  const matchedEvidence = [
    ...asArray(matchedValues).map(requirementConceptEvidence),
    ...eligibleStructuredEvidence,
  ].filter((evidence) => evidence.bucket)
  const missingEvidence = asArray(missingValues).map(requirementConceptEvidence).filter((evidence) => evidence.bucket)
  const matchedBuckets = new Set(matchedEvidence.map((evidence) => evidence.bucket))
  const missingBucketsRaw = new Set(missingEvidence.map((evidence) => evidence.bucket))
  const missingBuckets = new Set()
  const missingCanonicalByBucket = new Map()

  for (const missing of missingEvidence) {
    const covered = matchedEvidence.some((matched) => missingEvidenceCoveredByMatch(missing, matched))
    if (covered) continue
    const bucketCanonicals = missingCanonicalByBucket.get(missing.bucket) ?? new Set()
    bucketCanonicals.add(missing.canonical)
    missingCanonicalByBucket.set(missing.bucket, bucketCanonicals)
    missingBuckets.add(missing.bucket)
  }

  const buckets = [...new Set([...matchedBuckets, ...missingBuckets])].sort()
  const requirementBucketScores = Object.fromEntries(buckets.map((bucket) => [bucket, missingBuckets.has(bucket) ? 0 : 1]))
  return {
    matchedBuckets,
    missingBuckets,
    bucketCount: buckets.length,
    requirementBucketScores,
    structuredPositiveBucketCount: eligibleStructuredEvidence.length,
    smoothingApplied: asArray(matchedValues).length !== matchedBuckets.size
      || asArray(missingValues).length !== missingBuckets.size
      || missingBucketsRaw.size !== missingBuckets.size
      || [...missingCanonicalByBucket.values()].some((canonicals) => canonicals.size > 1),
  }
}

const numericValue = (value) => {
  if (!present(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const firstNumber = (...values) => {
  for (const value of values) {
    const number = numericValue(value)
    if (number !== null) return number
  }
  return null
}

const meaningfulJdValue = (value) => {
  if (Array.isArray(value)) return value.some(meaningfulJdValue)
  if (isObject(value)) return Object.values(value).some(meaningfulJdValue)
  if (typeof value === 'boolean') return false
  return present(value)
}

const hasJdContext = (context) => {
  if (!isObject(context)) return false
  if (context.hasContext === false) return false
  if (context.hasContext === true) return true

  return [
    context.title,
    context.jobTitle,
    context.description,
    context.jobDescription,
    context.requirements,
    context.required_requirements,
    context.skills,
    context.required_skills,
    context.location,
    context.fileText,
    context.required_min_years,
    context.required_max_years,
    context.min_years,
    context.max_years,
    context.minYears,
    context.maxYears,
    context.years_experience_min,
    context.years_experience_max,
    context.experienceMin,
    context.experienceMax,
    context.experienceYears,
    context.experience,
  ].some(meaningfulJdValue)
}

const requirementBreakdown = (fitAssessment, candidate = {}) => {
  const structuredEvidence = structuredPositiveEvidence(candidate)
  const evidence = normalizedRequirementEvidence(fitAssessment?.matched_requirements, fitAssessment?.missing_requirements, structuredEvidence)
  const matched = evidence.matchedBuckets.size
  const missing = evidence.missingBuckets.size
  const total = matched + missing
  const score = total > 0 ? smoothEvidenceRatioScore(matched, missing) : 35
  return {
    score: roundScore(score),
    weight: WEIGHTS.requirement_match,
    matched_count: matched,
    missing_count: missing,
    total_count: total,
    normalized_requirement_match_count: matched,
    normalized_requirement_missing_count: missing,
    normalized_requirement_bucket_count: evidence.bucketCount,
    requirement_bucket_scores: evidence.requirementBucketScores,
    structured_positive_bucket_count: evidence.structuredPositiveBucketCount,
    requirement_variance_smoothing_applied: evidence.smoothingApplied,
  }
}

const smoothEvidenceRatioScore = (matched, missing) => {
  const total = matched + missing
  if (total <= 0) return 35

  const rawScore = (matched / total) * 100
  const dampenedScore = 50 + ((rawScore - 50) * Math.min(1, total / 8))

  if (matched >= 2 && missing >= 2) return clamp(dampenedScore, 40, 60)
  return dampenedScore
}

const skillBreakdown = (candidate) => {
  const structuredEvidence = structuredPositiveEvidence(candidate)
  const skillEvidence = normalizedRequirementEvidence(candidate?.matchedSkills, candidate?.missingSkills, structuredEvidence)
  const matched = skillEvidence.matchedBuckets.size
  const missing = skillEvidence.missingBuckets.size
  const candidateSkillCount = uniqueNormalized([
    ...asArray(candidate?.skills_flat),
    ...asArray(candidate?.top_skills),
  ]).length
  const totalCompared = matched + missing
  let score = 35
  if (totalCompared > 0) score = smoothEvidenceRatioScore(matched, missing)
  else if (candidateSkillCount > 0) score = 55
  return {
    score: roundScore(score),
    weight: WEIGHTS.skill_alignment,
    matched_count: matched,
    missing_count: missing,
    candidate_skill_count: candidateSkillCount,
    normalized_requirement_match_count: matched,
    normalized_requirement_missing_count: missing,
    normalized_requirement_bucket_count: skillEvidence.bucketCount,
    requirement_bucket_scores: skillEvidence.requirementBucketScores,
    structured_positive_bucket_count: skillEvidence.structuredPositiveBucketCount,
    requirement_variance_smoothing_applied: skillEvidence.smoothingApplied,
  }
}

const requiredYears = (context) => {
  const experienceYears = context?.experienceYears
  const experienceYearsMin = isObject(experienceYears) ? experienceYears.min : experienceYears
  const experienceYearsMax = isObject(experienceYears) ? experienceYears.max : null
  const min = firstNumber(
    context?.required_min_years,
    context?.min_years,
    context?.minYears,
    context?.years_experience_min,
    context?.experienceMin,
    experienceYearsMin,
    context?.experience?.min,
    context?.experience?.minimum,
  )
  const max = firstNumber(
    context?.required_max_years,
    context?.max_years,
    context?.maxYears,
    context?.years_experience_max,
    context?.experienceMax,
    experienceYearsMax,
    context?.experience?.max,
    context?.experience?.maximum,
  )
  return { min, max }
}


const flattenText = (value) => {
  if (!present(value)) return []
  if (Array.isArray(value)) return value.flatMap(flattenText)
  if (isObject(value)) return Object.values(value).flatMap(flattenText)
  return [String(value)]
}

const STRUCTURED_POSITIVE_PATTERNS = Object.freeze([
  ['typescript_javascript_node', /\b(?:typescript|javascript|node\s*js|nodejs|node|express|nestjs?|nest\s*js)\b/i],
  ['frontend_js_framework', /\b(?:react|next\s*js|nextjs|vue\s*js|vuejs|vue)\b/i],
  ['backend_framework', /\b(?:express|nestjs?|nest\s*js|flask|django|fastapi|spring\s+boot|rails|laravel)\b/i],
  ['backend_api', /\b(?:backend|api|apis|rest|graphql|microservices?|server\s+side)\b/i],
  ['database_sql', /\b(?:sql|postgres|postgresql|mysql|database|databases|mongodb|mongo|nosql)\b/i],
  ['cloud_platforms', /\b(?:aws|azure|gcp|google\s+cloud|kubernetes|k8s|docker|container|containers|deployment|devops)\b/i],
  ['testing_ci', /\b(?:jest|testing|unit\s+test|integration\s+test|automation|ci\s*cd|cicd|github\s+actions?|pipeline|pipelines)\b/i],
  ['system_design', /\b(?:system\s+design|scalability|scalable|distributed\s+systems?|architecture|architectural|microservices?)\b/i],
  ['async_background', /\b(?:async|asynchronous|queue|queues|background\s+jobs?|workers?|caching|cache|redis|messaging|event\s+driven)\b/i],
  ['auth_security', /\b(?:auth|authentication|authorization|rbac|oauth|jwt|secure\s+api|security|permissions?)\b/i],
])

const structuredCandidateEvidenceTexts = (candidate) => {
  const richStructuredEvidence = [
    ...flattenText(candidate?.skills_structured),
    ...flattenText(candidate?.experience),
    ...flattenText(candidate?.experiences),
    ...flattenText(candidate?.work_experience),
    ...flattenText(candidate?.employment_history),
    ...flattenText(candidate?.projects),
    ...flattenText(candidate?.achievements),
  ]
  if (richStructuredEvidence.length === 0) return []
  return [
    ...flattenText(candidate?.skills_flat).map((text) => ({ text, source: 'flat_skill' })),
    ...flattenText(candidate?.top_skills).map((text) => ({ text, source: 'top_skill' })),
    ...richStructuredEvidence.map((text) => ({ text, source: 'rich_structured' })),
  ]
}

const structuredPositiveEvidence = (candidate) => {
  const evidenceByBucketAndStrength = new Map()
  for (const { text, source } of structuredCandidateEvidenceTexts(candidate)) {
    const normalized = withSemanticLanguageTokens(text)
    if (!normalized) continue
    for (const [bucket, pattern] of STRUCTURED_POSITIVE_PATTERNS) {
      if (!pattern.test(normalized)) continue
      const evidence = structuredConceptEvidence(normalized, bucket, source)
      const strengthKey = evidence.weak ? 'weak' : (evidence.strongCoverage ? 'strong' : 'neutral')
      evidenceByBucketAndStrength.set(`${bucket}:${source}:${strengthKey}`, evidence)
    }
  }
  return [...evidenceByBucketAndStrength.values()].sort((first, second) => first.bucket.localeCompare(second.bucket))
}


const structuredCoverageBuckets = (candidate) => new Set(
  structuredPositiveEvidence(candidate)
    .filter((evidence) => evidence.structured && evidence.source === 'rich_structured' && !evidence.weak)
    .map((evidence) => evidence.bucket)
    .filter(Boolean),
)

const hasStrongStructuredSdeCoverage = (candidate, fitAssessment = {}, context = {}) => {
  void fitAssessment
  void context
  const buckets = structuredCoverageBuckets(candidate)
  const hasCoreBackend = buckets.has('typescript_javascript_node') && buckets.has('backend_api') && buckets.has('database_sql')
  const hasDeliveryDepth = buckets.has('testing_ci') && buckets.has('cloud_platforms')
  const depthBucketCount = ['system_design', 'async_background', 'auth_security'].filter((bucket) => buckets.has(bucket)).length
  return hasCoreBackend && hasDeliveryDepth && depthBucketCount >= 2 && buckets.size >= 7
}


const candidateExperienceEvidenceTexts = (candidate, fitAssessment) => [
  ...flattenText(candidate?.years_experience_notes),
  ...flattenText(candidate?.experience_summary),
  ...flattenText(candidate?.summary),
  ...flattenText(candidate?.recommendation),
  ...flattenText(candidate?.matchScore?.reason),
  ...flattenText(candidate?.matchScore?.breakdown),
  ...flattenText(candidate?.experience),
  ...flattenText(candidate?.experiences),
  ...flattenText(candidate?.work_experience),
  ...flattenText(candidate?.employment_history),
  ...flattenText(candidate?.projects),
  ...flattenText(candidate?.achievements),
  ...flattenText(fitAssessment?.rationale),
  ...flattenText(fitAssessment?.notes),
  ...flattenText(fitAssessment?.risks_or_gaps),
  ...flattenText(candidate?.missingSkills),
  ...flattenText(fitAssessment?.missing_requirements),
  ...flattenText(candidate?.concerns),
  ...flattenText(candidate?.considerations),
  ...flattenText(fitAssessment?.concerns),
  ...flattenText(fitAssessment?.considerations),
]

const BELOW_MIN_EXPERIENCE_PATTERNS = Object.freeze([
  /\bbelow\s+(?:the\s+)?(?:minimum|required|target)\s+(?:\w+\s+){0,3}(?:experience|years?|yrs?)\b/i,
  /\b(?:experience|years?)\s+gap\b/i,
  /\bjunior\s+profile\b/i,
  /\bearly\s+career\b/i,
  /\bbelow\s+\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*\d+(?:\.\d+)?\s*years?\b/i,
  /\bbelow\s+(?:the\s+)?\d+(?:\.\d+)?\s*-\s*year\s+(?:minimum|required|target|requirement)\b/i,
  /\bbelow\s+(?:the\s+)?\d+(?:\.\d+)?\s*(?:years?|yrs?)\s+(?:minimum|required|target|requirement)\b/i,
  /\bbelow\s+required\s+years?\b/i,
  /\bless\s+than\s+(?:the\s+)?(?:minimum|required|target)\s+(?:\w+\s+){0,3}(?:experience|years?|yrs?)\b/i,
  /\bfalls?\s+(?:below|short\s+of)\s+(?:the\s+)?(?:\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*\d+(?:\.\d+)?\s*years?|\d+(?:\.\d+)?\s*(?:years?|yrs?)|(?:minimum|required|target)\s+(?:\w+\s+){0,3}(?:experience|years?|yrs?))\b/i,
  /\bshort\s+of\s+(?:the\s+)?(?:\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*\d+(?:\.\d+)?\s*years?|\d+(?:\.\d+)?\s*(?:years?|yrs?)|(?:minimum|required|target)\s+(?:\w+\s+){0,3}(?:experience|years?|yrs?))\b/i,
])

const TOTAL_EXPERIENCE_CONTEXT_PATTERN = /\b(?:total|overall|professional|relevant|engineering|software|work)\s+(?:\w+\s+){0,3}experience\b|\bexperience\s*(?::|-)?\s*\d+(?:\.\d+)?\s*(?:years?|yrs?)\b/i
const BELOW_MINIMUM_CONTEXT_PATTERN = /\b(?:below|minimum|required|target|gap|junior|early\s+career)\b/i
const SKILL_DURATION_CONTEXT_PATTERN = /\b(?:including|with|in|using|on|for|of)\s+[a-z0-9.+#-]+\b/i
const TOTAL_EXPERIENCE_AFTER_DURATION_PATTERN = /^\s*(?:of\s+)?(?:(?:total|overall|professional|relevant|engineering|software|work|career)\s+){0,4}experience\b/i
const PROFESSIONAL_ROLE_AFTER_DURATION_PATTERN = /^\s*(?:as\s+(?:a|an)\s+)?(?:software|backend|frontend|full\s*stack|fullstack|web|application|platform|systems?)\s+(?:development\s+)?(?:engineer|developer|programmer)\b/i
const PRODUCTION_BUILDING_AFTER_DURATION_PATTERN = /^\s*(?:building|developing|delivering|shipping|owning|implementing)\s+(?:\w+\s+){0,4}(?:production|saas|software|backend|frontend|full\s*stack|fullstack|web|platform|systems?|applications?|features?|services?|apis?)\b/i
const SKILL_DURATION_NEAR_PATTERN = /\b(?:(?:of|with|in|using|on|for)\s+)?(?:react|next\s*js|nextjs|vue|angular|typescript|javascript|python|java|go|golang|ruby|php|c\s*\+\s*\+|cpp|c#|csharp|node\s*js|nodejs|express|nestjs?|django|flask|fastapi|spring|postgres|postgresql|mysql|mongodb|mongo|sql|redis|aws|azure|gcp|google\s+cloud|docker|kubernetes|k8s|terraform|jenkins|github\s+actions|ci\s*cd)(?:\s+(?:experience|exposure|development|work|projects?))?\b/i
const EXPERIENCE_SHORTFALL_CONTEXT_PATTERN = /\b(?:below|under|short|shortfall|gap|deficit|less\s+than)\b/i

const reliableTotalExperienceYearsFromText = (text) => {
  const source = String(text ?? '')
  const matches = [...source.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)\b/gi)]
  const values = []

  for (const match of matches) {
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue

    const index = match.index ?? 0
    const before = source.slice(Math.max(0, index - 45), index)
    const after = source.slice(index + match[0].length, Math.min(source.length, index + match[0].length + 45))
    const near = `${before} ${match[0]} ${after}`
    const afterNumber = source.slice(index + match[0].length, Math.min(source.length, index + match[0].length + 24))
    const beforeNumber = source.slice(Math.max(0, index - 24), index)
    const explicitTotalContext = TOTAL_EXPERIENCE_CONTEXT_PATTERN.test(near)
      || TOTAL_EXPERIENCE_AFTER_DURATION_PATTERN.test(after)
      || PROFESSIONAL_ROLE_AFTER_DURATION_PATTERN.test(after)
      || PRODUCTION_BUILDING_AFTER_DURATION_PATTERN.test(after)
    const skillSpecific = SKILL_DURATION_NEAR_PATTERN.test(`${beforeNumber} ${after}`)
      || (SKILL_DURATION_CONTEXT_PATTERN.test(`${beforeNumber} ${afterNumber}`) && !explicitTotalContext)
    const shortfallSpecific = EXPERIENCE_SHORTFALL_CONTEXT_PATTERN.test(near)
      && (/\b(?:below|under|short|shortfall|gap|deficit|less\s+than)\b/i.test(`${beforeNumber} ${afterNumber}`) || /\bby\s*$/i.test(beforeNumber))
      && !/\b(?:has|have|having|with|total|overall|professional|relevant|engineering|software|work)\s*$/i.test(beforeNumber)
      && (/\bby\s*$/i.test(beforeNumber) || !/\b(?:has|have|having|with)\b/i.test(beforeNumber))
      && !/^\s*(?:of\s+)?(?:total\s+|professional\s+|relevant\s+)?experience\b/i.test(afterNumber)
    const totalExperience = explicitTotalContext || /\bhas\s*$/i.test(beforeNumber)
    const belowMinimumContext = BELOW_MINIMUM_CONTEXT_PATTERN.test(near)

    if (!skillSpecific && !shortfallSpecific && (totalExperience || belowMinimumContext)) values.push(value)
  }

  return values.length > 0 ? Math.min(...values) : null
}

const belowMinimumExperienceEvidence = (candidate, fitAssessment, requiredMin) => {
  if (requiredMin === null || requiredMin < 2) return { applies: false, safer_years: null, signal_count: 0 }

  let saferYears = null
  let signalCount = 0
  for (const text of candidateExperienceEvidenceTexts(candidate, fitAssessment)) {
    const explicitYears = reliableTotalExperienceYearsFromText(text)
    const normalized = String(text ?? '')
    const hasBelowSignal = BELOW_MIN_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(normalized))
    const hasBelowRequiredRange = new RegExp(`\\bbelow\\s+${requiredMin}(?:\\.0+)?\\s*(?:-|to|–|—)\\s*\\d+(?:\\.\\d+)?\\s*years?\\b`, 'i').test(normalized)
    const explicitBelowMin = explicitYears !== null && explicitYears < requiredMin && /\b(?:years?|yrs?|experience)\b/i.test(normalized)
    if (hasBelowSignal || hasBelowRequiredRange || explicitBelowMin) {
      signalCount += 1
      if (explicitYears !== null) saferYears = saferYears === null ? explicitYears : Math.min(saferYears, explicitYears)
    }
  }

  return { applies: signalCount > 0, safer_years: saferYears, signal_count: signalCount }
}

const ROLE_GAP_PATTERNS = Object.freeze([
  /\bnot\s+sde\b/i,
  /\bqa\b|quality assurance/i,
  /production feature/i,
  /production software development/i,
  /backend ownership/i,
  /service ownership/i,
  /system design/i,
  /architecture/i,
  /\bcloud\b/i,
  /deployment/i,
  /data structures/i,
  /algorithms/i,
])

const roleGapSignalCount = (fitAssessment) => {
  const buckets = new Set()
  const signals = [
    ...asArray(fitAssessment?.missing_requirements),
    ...asArray(fitAssessment?.risks_or_gaps),
  ]
  for (const signal of signals) {
    const text = String(signal ?? '')
    if (ROLE_GAP_PATTERNS.some((pattern) => pattern.test(text))) buckets.add(requirementConceptKey(text))
  }
  return buckets.size
}

const experienceRelevanceCap = ({ requirement, skill, roleGapCount }) => {
  const weakRequirementEvidence = requirement.missing_count >= requirement.matched_count && requirement.missing_count >= 2
  const weakSkillEvidence = skill.missing_count >= skill.matched_count && skill.missing_count >= 2
  const weakScoreEvidence = requirement.score < 55 || skill.score < 55

  if (roleGapCount >= 4 && (weakRequirementEvidence || weakSkillEvidence || weakScoreEvidence)) return 55
  if (roleGapCount >= 2 && (weakRequirementEvidence || weakSkillEvidence) && weakScoreEvidence) return 65
  if (roleGapCount >= 1 && requirement.score < 40 && skill.score < 40) return 75
  return null
}

const experienceBreakdown = (candidate, context, fitAssessment, requirement, skill) => {
  const candidateYears = firstNumber(candidate?.years_experience, candidate?.yearsExperience)
  const required = requiredYears(context)
  const roleGapCount = roleGapSignalCount(fitAssessment)
  const belowMinEvidence = belowMinimumExperienceEvidence(candidate, fitAssessment, required.min)
  const saferCandidateYears = belowMinEvidence.safer_years !== null && candidateYears !== null
    ? Math.min(candidateYears, belowMinEvidence.safer_years)
    : (belowMinEvidence.safer_years ?? candidateYears)
  let score = 55
  let cap = null
  if (saferCandidateYears === null) score = belowMinEvidence.applies ? 55 : 35
  else if (required.min === null && required.max === null) score = 60
  else if (required.min !== null && saferCandidateYears < required.min) score = Math.max(20, (saferCandidateYears / Math.max(required.min, 1)) * 70)
  else {
    score = 100
    cap = experienceRelevanceCap({ requirement, skill, roleGapCount })
    if (belowMinEvidence.applies) cap = Math.min(cap ?? 58, 58)
    if (cap !== null) score = Math.min(score, cap)
  }
  const roundedScore = roundScore(score)
  const shortfallYears = required.min !== null && saferCandidateYears !== null
    ? roundScore(Math.max(0, required.min - saferCandidateYears))
    : null
  return {
    score: roundedScore,
    weight: WEIGHTS.experience_alignment,
    candidate_years: candidateYears,
    resolved_experience_years: saferCandidateYears,
    required_min_years: required.min,
    required_max_years: required.max,
    experience_shortfall_years: shortfallYears,
    experience_resolution_source: belowMinEvidence.safer_years !== null ? 'explicit_below_minimum_evidence' : (candidateYears !== null ? 'candidate_years' : 'unresolved'),
    experience_relevance_cap_applied: cap !== null || belowMinEvidence.applies,
    role_gap_signal_count: roleGapCount,
    below_min_experience_evidence_applied: belowMinEvidence.applies,
    below_min_experience_signal_count: belowMinEvidence.signal_count,
    safer_candidate_years: saferCandidateYears,
  }
}

const normalizeLocation = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const normalizeLocationToken = (value) => normalizeLocation(value).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
const hasExplicitRemote = (value) => /\bremote\b/.test(value)
const hasFlexibleLocation = (value) => /\bremote\b|\bhybrid\b/.test(value)
const WORK_MODE_LOCATION_TOKENS = new Set(['remote', 'hybrid', 'remote hybrid', 'onsite', 'on site'])
const tokenizeJdLocations = (value) => normalizeLocation(value)
  .split(/\s*(?:\/|,|;|\||\bor\b|\band\b)\s*/i)
  .map(normalizeLocationToken)
  .filter((token) => token.length > 0 && !WORK_MODE_LOCATION_TOKENS.has(token))
const locationTokenMatches = (candidateLocation, jdLocation) => tokenizeJdLocations(jdLocation)
  .some((token) => candidateLocation === token || candidateLocation.startsWith(`${token},`) || candidateLocation.includes(` ${token} `))
const locationBreakdown = (candidate, context) => {
  const candidateLocation = normalizeLocation(candidate?.location)
  const jdLocation = normalizeLocation(context?.location)
  const candidateAvailable = candidateLocation.length > 0
  const jdAvailable = jdLocation.length > 0
  let score = 50
  if (candidateAvailable && jdAvailable) {
    const candidateRemote = hasExplicitRemote(candidateLocation)
    const jdFlexible = hasFlexibleLocation(jdLocation)
    if (candidateLocation.includes(jdLocation) || jdLocation.includes(candidateLocation) || locationTokenMatches(candidateLocation, jdLocation)) score = 95
    else if (candidateRemote && jdFlexible) score = 80
    else if (jdFlexible) score = 40
    else if (candidateRemote) score = 35
    else score = 25
  }
  return { score, weight: WEIGHTS.location_alignment, candidate_location_available: candidateAvailable, jd_location_available: jdAvailable }
}

const evidenceBreakdown = (candidate, context, fitAssessment) => {
  const signals = [
    asArray(fitAssessment?.matched_requirements).length || asArray(fitAssessment?.missing_requirements).length,
    uniqueNormalized([...asArray(candidate?.matchedSkills), ...asArray(candidate?.missingSkills), ...asArray(candidate?.skills_flat), ...asArray(candidate?.top_skills)]).length,
    firstNumber(candidate?.years_experience, candidate?.yearsExperience) !== null,
    present(candidate?.location) && present(context?.location),
    isObject(candidate?.confidence),
  ].filter(Boolean).length
  return { score: roundScore((signals / 5) * 100), weight: WEIGHTS.evidence_completeness, available_signal_count: signals }
}

const profilePriorBreakdown = (candidate) => {
  const profileScore = numericValue(candidate?.profile_score)
  return { score: profileScore === null ? 50 : roundScore(profileScore), weight: WEIGHTS.profile_prior, used: profileScore !== null }
}

const confidenceBreakdown = (candidate) => {
  const confidence = isObject(candidate?.confidence) ? candidate.confidence : {}
  const values = [confidence.skills, confidence.experience, confidence.fit_assessment].map(numericValue).filter((value) => value !== null)
  if (values.length === 0) return { multiplier: 0.95, available_confidence_fields: 0 }
  const normalized = values.map((value) => (value > 1 ? value / 100 : value))
  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length
  return { multiplier: roundScore(90 + clamp(average, 0, 1) * 10) / 100, available_confidence_fields: values.length }
}

const riskBreakdown = (fitAssessment) => {
  const gapBuckets = new Set(asArray(fitAssessment?.risks_or_gaps).map(requirementConceptKey).filter(Boolean))
  const gapCount = gapBuckets.size
  return { penalty: Math.min(10, gapCount * 2), gap_count: gapCount }
}


const strongFloorHardDisqualifierEvidenceTexts = (candidate, fitAssessment) => [
  ...flattenText(candidate?.years_experience_notes),
  ...flattenText(candidate?.experience_summary),
  ...flattenText(candidate?.summary),
  ...flattenText(candidate?.recommendation),
  ...flattenText(candidate?.experience),
  ...flattenText(candidate?.experiences),
  ...flattenText(candidate?.work_experience),
  ...flattenText(candidate?.employment_history),
  ...flattenText(candidate?.projects),
  ...flattenText(candidate?.achievements),
  ...flattenText(fitAssessment?.notes),
  ...flattenText(fitAssessment?.missing_requirements),
  ...flattenText(fitAssessment?.risks_or_gaps),
]

const STRONG_FLOOR_HARD_DISQUALIFIER_PATTERNS = Object.freeze([
  ['junior_or_entry_level_profile', /\b(?:junior\s+profile|junior\s+candidate|junior[-\s]*level\s+(?:candidate|experience|profile)|junior\s+role|junior[-\s]*only\s+experience|early[-\s]*career|entry[-\s]*level|graduate|trainee)\b/i],
  ['frontend_only_or_unrelated_profile', /\b(?:frontend[-\s]*only|frontend\s+only|frontend[-\s]*leaning|frontend\s+focused|unrelated\s+(?:profile|background|role)|not\s+related)\b/i],
  ['no_backend_experience', /\b(?:no\s+backend\s+(?:experience|evidence|ownership|delivery)|limited\s+backend\s+(?:experience|evidence|ownership|delivery)|without\s+backend\s+(?:experience|evidence|ownership|delivery))\b/i],
  ['manual_testing_only', /\b(?:manual\s+api\s+testing\s+only|manual\s+testing\s+only|manual[-\s]*only|only\s+manual\s+(?:qa|testing)|manual\s+qa\s+only)\b/i],
  ['toy_demo_academic_only', /\b(?:toy\s+demo|demo\s+only|academic\s+only|toy\s+project|demo\s+project)\b/i],
  ['non_sde_role_mismatch', /\b(?:not\s+sde|non[-\s]*sde|qa[-\s]*focused|quality\s+assurance\s+(?:background|profile|role)|role\s+transition\s+risk)\b/i],
])

const uniqueReasonCodes = (reasons) => [...new Set(reasons)].sort()

const getStrongFloorHardDisqualifierReasons = (candidate, fitAssessment, context, breakdown = {}, cap = null) => {
  const reasons = []
  if (!hasJdContext(context)) reasons.push('missing_jd_context')
  if ((breakdown.evidence_completeness?.available_signal_count ?? 0) < 4) reasons.push('insufficient_evidence')
  if (breakdown.experience_alignment?.below_min_experience_evidence_applied) reasons.push('below_minimum_experience')
  if ((breakdown.experience_alignment?.score ?? 0) < 70) reasons.push('weak_experience_alignment')
  if (cap !== null && cap < 85) reasons.push('score_cap_below_floor')

  for (const text of strongFloorHardDisqualifierEvidenceTexts(candidate, fitAssessment)) {
    const normalized = String(text ?? '')
    for (const [reason, pattern] of STRONG_FLOOR_HARD_DISQUALIFIER_PATTERNS) {
      if (pattern.test(normalized)) reasons.push(reason)
    }
  }

  return uniqueReasonCodes(reasons)
}

const shouldApplyStrongStructuredFinalFloor = (candidate, fitAssessment, context, breakdown, cap) => {
  if (!hasStrongStructuredSdeCoverage(candidate, fitAssessment, context)) return false
  return getStrongFloorHardDisqualifierReasons(candidate, fitAssessment, context, breakdown, cap).length === 0
}

const CORE_DEPTH_GAP_BUCKETS = new Set(['system_design', 'cloud_platforms', 'testing_ci', 'async_background', 'auth_security'])

const finalScoreCapDetails = (breakdown) => {
  const reasons = []
  const roleGapCount = breakdown.experience_alignment?.role_gap_signal_count ?? 0
  const missingCoreDepthBuckets = new Set([
    ...Object.entries(breakdown.requirement_match?.requirement_bucket_scores ?? {})
      .filter(([bucket, score]) => CORE_DEPTH_GAP_BUCKETS.has(bucket) && score === 0)
      .map(([bucket]) => bucket),
    ...Object.entries(breakdown.skill_alignment?.requirement_bucket_scores ?? {})
      .filter(([bucket, score]) => CORE_DEPTH_GAP_BUCKETS.has(bucket) && score === 0)
      .map(([bucket]) => bucket),
  ])

  const experience = breakdown.experience_alignment ?? {}
  const resolvedBelowMinimum = experience.resolved_experience_years !== null
    && experience.resolved_experience_years !== undefined
    && experience.required_min_years !== null
    && experience.required_min_years !== undefined
    && experience.resolved_experience_years < experience.required_min_years
  const clearJuniorOrBelowThreshold = resolvedBelowMinimum || roleGapCount >= 2

  if (experience.below_min_experience_evidence_applied && roleGapCount >= 4) {
    reasons.push('below_minimum_role_gap_cap')
    return { cap: 49, reasons: uniqueReasonCodes(reasons) }
  }
  if (experience.below_min_experience_evidence_applied && clearJuniorOrBelowThreshold) {
    reasons.push('below_minimum_junior_cap')
    return { cap: 55, reasons: uniqueReasonCodes(reasons) }
  }
  if (missingCoreDepthBuckets.size >= 2 && roleGapCount >= 2) {
    reasons.push('core_depth_gap_cap')
    return { cap: 92, reasons: uniqueReasonCodes(reasons) }
  }
  return { cap: null, reasons: [] }
}

const bandAndVerdict = (score) => {
  if (score === null) return { score_band: 'insufficient_evidence', verdict: 'Insufficient evidence' }
  if (score >= 85) return { score_band: 'excellent', verdict: 'Highly aligned' }
  if (score >= 70) return { score_band: 'strong', verdict: 'Aligned' }
  if (score >= 50) return { score_band: 'moderate', verdict: 'Potential fit' }
  return { score_band: 'weak', verdict: 'Low fit' }
}

const emptyBreakdown = () => ({
  requirement_match: { score: 0, weight: WEIGHTS.requirement_match, matched_count: 0, missing_count: 0, total_count: 0 },
  skill_alignment: { score: 0, weight: WEIGHTS.skill_alignment, matched_count: 0, missing_count: 0, candidate_skill_count: 0 },
  experience_alignment: { score: 0, weight: WEIGHTS.experience_alignment, candidate_years: null, required_min_years: null, required_max_years: null },
  location_alignment: { score: 0, weight: WEIGHTS.location_alignment, candidate_location_available: false, jd_location_available: false },
  evidence_completeness: { score: 0, weight: WEIGHTS.evidence_completeness, available_signal_count: 0 },
  profile_prior: { score: 0, weight: WEIGHTS.profile_prior, used: false },
  risk_penalty: { penalty: 0, gap_count: 0 },
  confidence_adjustment: { multiplier: 0.95, available_confidence_fields: 0 },
})

export function scoreCandidateDeterministically(candidate = {}, jobDescriptionContext = null, options = {}) {
  void options
  const safeCandidate = isObject(candidate) ? candidate : {}
  const fitAssessment = isObject(safeCandidate.fit_assessment) ? safeCandidate.fit_assessment : {}
  const jdAvailable = hasJdContext(jobDescriptionContext)

  if (!jdAvailable) {
    const profile = profilePriorBreakdown(safeCandidate)
    const hasProfileOnly = profile.used
    const finalScore = hasProfileOnly ? roundScore(profile.score) : null
    const mapping = bandAndVerdict(finalScore)
    return {
      final_score: finalScore,
      score_out_of_ten: finalScore === null ? null : Math.round(finalScore) / 10,
      ...mapping,
      scoring_mode: hasProfileOnly ? 'profile_only' : 'insufficient_evidence',
      scoring_contract_version: CONTRACT_VERSION,
      scoring_breakdown: { ...emptyBreakdown(), profile_prior: profile },
      scoring_explanation: hasProfileOnly
        ? 'Profile-only deterministic fallback used because no job description context was available.'
        : 'Insufficient structured evidence to compute a deterministic JD-fit score.',
    }
  }

  const requirement = requirementBreakdown(fitAssessment, safeCandidate)
  const skill = skillBreakdown(safeCandidate)
  const breakdown = {
    requirement_match: requirement,
    skill_alignment: skill,
    experience_alignment: experienceBreakdown(safeCandidate, jobDescriptionContext, fitAssessment, requirement, skill),
    location_alignment: locationBreakdown(safeCandidate, jobDescriptionContext),
    evidence_completeness: evidenceBreakdown(safeCandidate, jobDescriptionContext, fitAssessment),
    profile_prior: profilePriorBreakdown(safeCandidate),
    risk_penalty: riskBreakdown(fitAssessment),
    confidence_adjustment: confidenceBreakdown(safeCandidate),
  }

  const weighted = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + breakdown[key].score * weight, 0)
  const uncappedFinalScoreBeforeRounding = clamp((weighted - breakdown.risk_penalty.penalty) * breakdown.confidence_adjustment.multiplier, 0, 100)
  const capDetails = finalScoreCapDetails(breakdown)
  const cap = capDetails.cap
  const finalScoreBeforeRounding = cap === null
    ? uncappedFinalScoreBeforeRounding
    : Math.min(uncappedFinalScoreBeforeRounding, cap)
  const roundedFinalScore = roundScore(finalScoreBeforeRounding)
  const strongFloorHardDisqualifierReasons = getStrongFloorHardDisqualifierReasons(safeCandidate, fitAssessment, jobDescriptionContext, breakdown, cap)
  const strongStructuredFinalFloorEligible = shouldApplyStrongStructuredFinalFloor(safeCandidate, fitAssessment, jobDescriptionContext, breakdown, cap)
  const strongStructuredFinalFloorApplied = strongStructuredFinalFloorEligible && roundedFinalScore < 85
  const finalScore = strongStructuredFinalFloorEligible
    ? clamp(Math.max(roundedFinalScore, STRONG_STRUCTURED_FINAL_FLOOR), 0, STRONG_STRUCTURED_FINAL_CEILING)
    : roundedFinalScore
  const mapping = bandAndVerdict(finalScore)

  return {
    final_score: finalScore,
    score_out_of_ten: Math.round(finalScore) / 10,
    ...mapping,
    scoring_mode: 'jd_fit',
    scoring_contract_version: CONTRACT_VERSION,
    final_score_before_rounding: finalScoreBeforeRounding,
    final_score_floor_applied: strongStructuredFinalFloorApplied,
    strong_floor_hard_disqualifier_reasons: strongFloorHardDisqualifierReasons,
    score_cap_applied: cap !== null && uncappedFinalScoreBeforeRounding > cap,
    final_score_cap_reasons: capDetails.reasons,
    scoring_breakdown: breakdown,
    scoring_explanation: 'Deterministic JD-fit score computed from structured requirement, skill, experience, location, evidence, risk, and confidence signals.',
  }
}
