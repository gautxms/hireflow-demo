import { createHash } from 'node:crypto'
import { buildRequirementSemantics } from '../utils/requirementSemantics.js'
import { resolveJobWorkMode } from '../utils/locationAlignment.js'

export const JOB_DESCRIPTION_SCORING_CONTEXT_VERSION = 'canonical_jd_scoring_v1'

function normalizeCanonicalText(value) {
  if (value === null || value === undefined || typeof value === 'object') return null

  const normalized = String(value)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .map((line) => line
      .replace(/^[\u2022\u2023\u25E6\u2043\u2219*-]\s*/u, '- ')
      .replace(/[\t\u00A0 ]+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return normalized || null
}

function normalizeCanonicalNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeCanonicalSkills(value) {
  const entries = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : [])

  const grouped = new Map()
  for (const entry of entries) {
    const normalized = normalizeCanonicalText(entry)
    if (!normalized) continue
    const key = normalized.toLocaleLowerCase('en-US')
    const current = grouped.get(key)
    if (!current || normalized.localeCompare(current, 'en-US') < 0) {
      grouped.set(key, normalized)
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([, displayValue]) => displayValue)
}

function buildFingerprintSource(context) {
  return {
    version: JOB_DESCRIPTION_SCORING_CONTEXT_VERSION,
    title: context.title,
    description: context.description,
    requirements: context.requirements,
    responsibilities: context.responsibilities,
    additionalInfo: context.additionalInfo,
    skills: context.skills,
    experienceMin: context.experienceMin,
    experienceMax: context.experienceMax,
    location: context.location,
    workMode: context.workMode,
  }
}

function fingerprintCanonicalContext(context) {
  return createHash('sha256')
    .update(JSON.stringify(buildFingerprintSource(context)))
    .digest('hex')
}

export function buildCanonicalJobDescriptionScoringContext(jobDescriptionContext = null) {
  if (!jobDescriptionContext?.hasContext) {
    return {
      hasContext: false,
      missingReason: normalizeCanonicalText(jobDescriptionContext?.missingReason) || 'job_description_missing',
      scoringContextVersion: JOB_DESCRIPTION_SCORING_CONTEXT_VERSION,
      scoringContextFingerprint: null,
    }
  }

  const experienceYears = normalizeCanonicalNumber(
    jobDescriptionContext.experienceYears ?? jobDescriptionContext.experience_years,
  )
  const experienceMin = normalizeCanonicalNumber(
    jobDescriptionContext.experienceMin
      ?? jobDescriptionContext.experience_min
      ?? experienceYears,
  )
  const experienceMax = normalizeCanonicalNumber(
    jobDescriptionContext.experienceMax
      ?? jobDescriptionContext.experience_max
      ?? experienceYears,
  )

  const canonical = {
    hasContext: true,
    title: normalizeCanonicalText(jobDescriptionContext.title),
    description: normalizeCanonicalText(jobDescriptionContext.description),
    requirements: normalizeCanonicalText(jobDescriptionContext.requirements),
    responsibilities: normalizeCanonicalText(
      jobDescriptionContext.responsibilities ?? jobDescriptionContext.keyResponsibilities,
    ),
    additionalInfo: normalizeCanonicalText(
      jobDescriptionContext.additionalInfo ?? jobDescriptionContext.additional_info,
    ),
    skills: normalizeCanonicalSkills(jobDescriptionContext.skills),
    experienceYears: experienceMin !== null && experienceMin === experienceMax ? experienceMin : null,
    experienceMin,
    experienceMax,
    location: normalizeCanonicalText(jobDescriptionContext.location),
    workMode: null,
    employmentType: null,
    scoringContextVersion: JOB_DESCRIPTION_SCORING_CONTEXT_VERSION,
  }

  canonical.workMode = resolveJobWorkMode({
    ...canonical,
    workMode: normalizeCanonicalText(jobDescriptionContext.workMode ?? jobDescriptionContext.work_mode),
    employmentType: normalizeCanonicalText(
      jobDescriptionContext.employmentType ?? jobDescriptionContext.employment_type,
    ),
  })
  canonical.employmentType = canonical.workMode
  canonical.requirementSemantics = buildRequirementSemantics(canonical)
  canonical.scoringContextFingerprint = fingerprintCanonicalContext(canonical)

  return canonical
}
