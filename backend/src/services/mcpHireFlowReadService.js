import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import { buildAnalysisDetailPayload, loadAnalysisReadModel } from './analysisReadModelService.js'
import {
  getResumeQuotaUsageAvailabilitySnapshot,
  isResumeQuotaReservationsEnabled,
} from './resumeQuotaReservations.js'
import { resolveResumeQuotaPeriod, RESUME_QUOTA_PERIOD_SOURCES } from '../utils/resumeQuotaPeriod.js'
import { canUsePaidMutation, hasScheduledCancellationAccess } from '../utils/subscriptionAccess.js'
import { resolveCandidateMatchLabel } from '../../../shared/candidateMatchClassification.js'

function monthStart(referenceDate = new Date()) {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
}

function monthEnd(start) {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
}

function optionalText(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function textArray(value) {
  if (!Array.isArray(value)) return []
  return value.map(optionalText).filter(Boolean)
}

function boundedNumber(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(min, Math.min(max, numeric))
}

function parseScorePercentage(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return Math.round(value * 100)
    return Math.round(Math.max(0, Math.min(100, value)))
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  const percentMatch = normalized.match(/^\(?\s*(\d+(?:\.\d+)?)\s*%\s*\)?$/)
  if (percentMatch) return Math.round(Math.max(0, Math.min(100, Number(percentMatch[1]))))
  const scoreMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*\/\s*100(?:\s*(?:[-–—:]|\().*)?$/)
  if (scoreMatch) return Math.round(Math.max(0, Math.min(100, Number(scoreMatch[1]))))
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return null
  if (numeric >= 0 && numeric <= 1) return Math.round(numeric * 100)
  return Math.round(Math.max(0, Math.min(100, numeric)))
}

const SCORE_BREAKDOWN_ROWS = [
  { key: 'skills_match', label: 'Skills match', keys: ['technical_skills', 'skills_match', 'skills', 'technicalSkills', 'skill_match_score', 'skills_match_score'] },
  { key: 'relevant_experience', label: 'Relevant experience', keys: ['experience_years', 'experience', 'years_experience', 'experienceYears', 'experience_match_score', 'relevant_experience_score'] },
  { key: 'education_relevance', label: 'Education relevance', keys: ['education', 'education_match', 'academic_background', 'educationMatch', 'education_match_score', 'education_relevance_score'] },
]

const AI_SCORE_BREAKDOWN_ROWS = [
  { key: 'skills_match', label: 'Skills match', keys: ['skills_match_score'] },
  { key: 'relevant_experience', label: 'Relevant experience', keys: ['relevant_experience_score'] },
  { key: 'education_relevance', label: 'Education relevance', keys: ['education_relevance_score'] },
  { key: 'seniority_progression', label: 'Seniority / progression', keys: ['seniority_progression_score'] },
]

function breakdownRows(source, definitions) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []
  return definitions.flatMap(({ key, label, keys }) => {
    for (const sourceKey of keys) {
      if (!(sourceKey in source)) continue
      const value = parseScorePercentage(source[sourceKey])
      if (value !== null) return [{ key, label, value }]
    }
    return []
  })
}

function normalizeBreakdown(candidate, matchScore, fitAssessment) {
  const sources = [
    [candidate?.scoreBreakdown?.categories, SCORE_BREAKDOWN_ROWS],
    [candidate?.scoreBreakdown, SCORE_BREAKDOWN_ROWS],
    [candidate?.score_breakdown, SCORE_BREAKDOWN_ROWS],
    [matchScore?.breakdown, SCORE_BREAKDOWN_ROWS],
    [candidate?.match_score?.breakdown, SCORE_BREAKDOWN_ROWS],
    [candidate?.ai_scoring_contract_v2, AI_SCORE_BREAKDOWN_ROWS],
  ]
  for (const [source, definitions] of sources) {
    const rows = breakdownRows(source, definitions)
    if (rows.length) return rows
  }
  const fitRows = breakdownRows(fitAssessment, [
    { key: 'skills_match', label: 'Skills match', keys: ['skill_match_score'] },
    { key: 'relevant_experience', label: 'Relevant experience', keys: ['experience_match_score'] },
    { key: 'education_relevance', label: 'Education relevance', keys: ['education_match_score'] },
    { key: 'role_alignment', label: 'Role Alignment', keys: ['role_alignment', 'roleAlignment', 'role_fit', 'roleFit', 'job_alignment'] },
  ])
  return fitRows
}

function normalizeEducation(value) {
  const records = (Array.isArray(value) ? value : [value]).flatMap((record, index) => {
    if (typeof record === 'string') {
      const text = optionalText(record)
      return text ? [{ degree: text, school: '', year: '', text, index }] : []
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) return []
    const degree = optionalText(record.degree || record.qualification || record.program || record.course || record.field_of_study || record.fieldOfStudy) || ''
    const school = optionalText(record.school || record.institution || record.university || record.college) || ''
    const yearSource = optionalText(record.graduation_year || record.graduationYear || record.year || record.dates) || ''
    const year = yearSource.match(/\b(19|20)\d{2}\b/)?.[0] || ''
    const text = optionalText(record.text || record.label || record.name) || ''
    return degree || school || text ? [{ degree, school, year, text, index }] : []
  })
  if (!records.length) return null
  const rank = (record) => {
    const text = `${record.degree} ${record.text}`.toLowerCase()
    if (/\b(ph\.?d|doctorate|doctoral|md)\b/.test(text)) return 4
    if (/\b(master|mba|mtech|m\.tech|ms\b|m\.s\b|msc|m\.sc|ma\b|m\.a\b)\b/.test(text)) return 3
    if (/\b(bachelor|btech|b\.tech|be\b|b\.e\b|bs\b|b\.s\b|ba\b|b\.a\b|bsc|b\.sc)\b/.test(text)) return 2
    if (/\b(diploma|certificate|certification)\b/.test(text)) return 1
    return 0
  }
  const selected = records.sort((a, b) => rank(b) - rank(a) || Number(b.year || -1) - Number(a.year || -1) || a.index - b.index)[0]
  const label = selected.degree && selected.school
    ? `${selected.degree} — ${selected.school}`
    : selected.degree || selected.school || selected.text
  return optionalText(selected.year ? `${label} (${selected.year})` : label)
}

const ACTION_RECOMMENDATION_PATTERNS = [
  /\b(?:do\s+not\s+)?shortlist(?:\s+for\b|\s+to\b|\b)/,
  /\bschedule\s+(?:an?\s+)?(?:interview|recruiter\s+screen|phone\s+screen|screen)\b/,
  /\b(?:proceed|advance)\s+to\s+(?:interview|recruiter\s+screen|phone\s+screen|screen|next\s+step|next\s+round)\b/,
  /\bmove\s+forward\s+with\s+(?:interview|recruiter\s+screen|phone\s+screen|screen|candidate|application)\b/,
  /\bput\s+(?:the\s+candidate\s+|her\s+|him\s+|them\s+)?on\s+hold\b/,
  /\bhold\s+(?:for|until)\b/,
  /\breject\s+(?:for|from)\b/,
  /\bfollow\s+up\s+(?:with|on|about|to)\b/,
  /\b(?:confirm|verify|validate|clarify|probe|assess|check)\s+\w+/,
  /\bask\s+(?:about|for|whether|if)\s+\w+/,
  /\bconsider\s+(?:her\s+|him\s+|them\s+|the\s+candidate\s+)?for\s+\w+/,
]

function normalizeRecommendation(candidate, fitAssessment, reason) {
  const recommendation = optionalText(candidate.recommendationFull
    || candidate.recommendation
    || fitAssessment.recommendation
    || fitAssessment.rationale)
  if (!recommendation) return null
  const normalized = recommendation.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!ACTION_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(normalized))) return null
  const normalizedReason = optionalText(reason)?.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  return normalizedReason && normalized === normalizedReason ? null : recommendation
}

function normalizeConfidenceLabel(candidate, fitAssessment, hasScore) {
  const explicit = [fitAssessment?.confidence, candidate?.confidence, candidate?.match_confidence]
    .map((value) => (typeof value === 'string' ? optionalText(value) : null))
    .find(Boolean)
  if (explicit) return explicit
  const numericValues = [
    candidate?.confidenceScores?.fit_assessment,
    candidate?.confidence?.fit_assessment,
    fitAssessment?.confidence_score,
    fitAssessment?.confidenceScore,
  ]
  for (const value of numericValues) {
    if (value === null || value === undefined || String(value).trim() === '') continue
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue
    const bounded = Math.max(0, Math.min(1, numeric))
    if (bounded >= 0.85) return 'High confidence'
    if (bounded >= 0.65) return 'Moderate confidence'
    return 'Low confidence'
  }
  return hasScore ? null : 'Low confidence'
}

function normalizeSkills(candidate) {
  const values = [candidate?.skills, candidate?.top_skills, candidate?.matchedSkills]
  const skills = []
  for (const value of values) {
    if (Array.isArray(value)) skills.push(...textArray(value))
    else if (typeof value === 'string') skills.push(...value.split(',').map(optionalText).filter(Boolean))
    else if (value && typeof value === 'object') {
      for (const nestedValue of Object.values(value)) skills.push(...textArray(nestedValue))
    }
  }
  return [...new Set(skills)]
}

export function normalizeMcpCandidateResult(candidate, { resumeId = '', filename = '', index = 0 } = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const fitAssessment = candidate.fit_assessment && typeof candidate.fit_assessment === 'object'
    ? candidate.fit_assessment
    : {}
  const matchScore = candidate.matchScore && typeof candidate.matchScore === 'object'
    ? candidate.matchScore
    : {}
  const score = boundedNumber(
    matchScore.score
      ?? candidate.score
      ?? candidate.profile_score
      ?? fitAssessment.overall_fit_score
      ?? candidate.scoreBreakdown?.overall,
    0,
    100,
  )
  const scoreOutOfTen = boundedNumber(matchScore.score_out_of_ten, 0, 10)
    ?? (score === null ? null : Math.round(score) / 10)
  const reason = optionalText(candidate.reasoningFull || matchScore.reasonFull || fitAssessment.reasonFull || matchScore.reason || fitAssessment.reason || fitAssessment.rationale)
  const summary = optionalText(candidate.summaryFull || candidate.summary || candidate.profile_summary)
  const risksOrGaps = textArray(candidate.risksOrGapsFull || fitAssessment.risks_or_gaps)
  const considerations = risksOrGaps.length
    ? risksOrGaps
    : textArray(candidate.considerationsFull || candidate.considerations || candidate.concerns)

  return {
    id: optionalText(candidate.id || candidate.resumeId || candidate.resume_id) || `${resumeId || 'candidate'}-${index}`,
    resumeId: optionalText(candidate.resumeId || candidate.resume_id || resumeId) || '',
    filename: optionalText(candidate.filename || filename) || '',
    name: optionalText(candidate.name || candidate.full_name || candidate.candidate_name) || 'Candidate',
    email: optionalText(candidate.email),
    phone: optionalText(candidate.phone || candidate.phone_number),
    title: optionalText(candidate.title || candidate.current_title),
    location: optionalText(candidate.location),
    yearsExperience: boundedNumber(candidate.years_experience, 0, 80),
    seniorityLevel: optionalText(candidate.seniority_level),
    education: normalizeEducation(candidate.education),
    score,
    scoreOutOfTen,
    verdict: resolveCandidateMatchLabel(scoreOutOfTen),
    confidenceLabel: normalizeConfidenceLabel(candidate, fitAssessment, scoreOutOfTen !== null),
    summary,
    reason,
    recommendation: normalizeRecommendation(candidate, fitAssessment, reason),
    strengths: textArray(candidate.strengthsFull || candidate.strengths),
    considerations,
    matchedRequirements: textArray(candidate.matchedRequirementsFull || candidate.matchedSkillsFull || fitAssessment.matched_requirements || fitAssessment.matched || candidate.matchedSkills),
    missingRequirements: textArray(candidate.missingRequirementsFull || candidate.mustHaveSkillsFull || candidate.missingSkillsFull || fitAssessment.missing_requirements || fitAssessment.missing || candidate.mustHaveSkills || candidate.missingSkills),
    risksOrGaps,
    skills: normalizeSkills(candidate),
    experienceHighlights: textArray(candidate.experienceHighlights || candidate.experience_highlights),
    breakdown: normalizeBreakdown(candidate, matchScore, fitAssessment),
    analysisMode: optionalText(candidate.analysis_mode),
  }
}

export async function listMcpJobs({ db, userId, query = '', limit = 20 }) {
  const search = String(query || '').trim()
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const result = await db.query(
    `SELECT id, title, status, department, location, updated_at
     FROM job_descriptions
     WHERE user_id = $1
       AND status <> 'archived'
       AND ($2 = '' OR title ILIKE '%' || $2 || '%')
     ORDER BY updated_at DESC
     LIMIT $3`,
    [userId, search, normalizedLimit],
  )

  return {
    jobs: result.rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      status: row.status,
      department: row.department || null,
      location: row.location || null,
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
  }
}

function toMcpAnalysisStatus(detail) {
  if (!detail) return null
  return {
    id: detail.analysisId,
    name: detail.name || 'Untitled analysis',
    status: detail.status,
    job: detail.jobDescriptionId
      ? { id: detail.jobDescriptionId, title: detail.jobDescriptionTitle || 'Untitled job' }
      : null,
    counts: {
      total: Number(detail.summary.total || 0),
      complete: Number(detail.summary.complete || 0),
      failed: Number(detail.summary.failed || 0),
      processing: Number(detail.summary.processing || 0),
      queued: Number(detail.summary.pending || 0),
    },
    createdAt: new Date(detail.createdAt).toISOString(),
    completedAt: detail.completedAt ? new Date(detail.completedAt).toISOString() : null,
  }
}

async function loadMcpAnalysisReadModel({ db, userId, analysisId, queue }) {
  return loadAnalysisReadModel({
    db,
    userId,
    analysisId,
    ...(queue !== undefined ? { queue } : {}),
  })
}

export async function getMcpAnalysisStatus({ db, userId, analysisId, queue }) {
  const readModel = await loadMcpAnalysisReadModel({ db, userId, analysisId, queue })
  return toMcpAnalysisStatus(buildAnalysisDetailPayload(readModel))
}

export async function getMcpAnalysisResults({ db, userId, analysisId, queue }) {
  const readModel = await loadMcpAnalysisReadModel({ db, userId, analysisId, queue })
  const detail = buildAnalysisDetailPayload(readModel)
  const status = toMcpAnalysisStatus(detail)
  if (!status) return null

  const candidates = []
  for (const item of detail.items) {
    const filename = item.originalFilename || item.filename || 'Unknown file'
    item.normalizedCandidates.forEach((candidate, index) => {
      const normalized = normalizeMcpCandidateResult(candidate, {
        resumeId: String(item.resumeId || ''),
        filename,
        index,
      })
      if (normalized) candidates.push(normalized)
    })
  }

  candidates.sort((left, right) => {
    if (left.score === null && right.score === null) return left.name.localeCompare(right.name)
    if (left.score === null) return 1
    if (right.score === null) return -1
    return right.score - left.score || left.name.localeCompare(right.name)
  })

  return {
    analysisId: status.id,
    name: status.name,
    status: status.status,
    job: status.job,
    counts: status.counts,
    candidates,
    failures: readModel.failures.map((failure) => ({
      filename: failure.filename || 'Unknown file',
      reason: 'HireFlow could not analyse this resume.',
    })),
    createdAt: status.createdAt,
    completedAt: status.completedAt,
  }
}

export async function getMcpResumeQuota({ db, userId, env = process.env, now = new Date() }) {
  const accountResult = await db.query(
    `SELECT subscription_status, subscription_plan, quota_anchor_at,
            subscription_started_at, trial_ends_at, cancellation_effective_at,
            current_period_end
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  )
  const account = accountResult.rows[0]
  if (!account) return null

  const legacyStart = monthStart(now)
  const overrideResult = await db.query(
    `SELECT upload_limit, reset_usage
     FROM usage_overrides
     WHERE user_id = $1 AND month_start = $2
     LIMIT 1`,
    [userId, legacyStart],
  )
  const usageOverride = overrideResult.rows[0] || null
  const subscriptionStatus = hasScheduledCancellationAccess(account, now)
    ? 'active'
    : account.subscription_status
  const limit = resolveMonthlyResumeAnalysisLimit(
    subscriptionStatus,
    usageOverride,
    account.subscription_plan,
  )
  const resolvedPeriod = resolveResumeQuotaPeriod({
    subscriptionStatus,
    quotaAnchorAt: account.quota_anchor_at,
    trialStartedAt: account.subscription_started_at,
    trialEndsAt: account.trial_ends_at || account.current_period_end,
    referenceDate: now,
  })
  const reservationsEnabled = isResumeQuotaReservationsEnabled(env)
  const period = reservationsEnabled || resolvedPeriod.source === RESUME_QUOTA_PERIOD_SOURCES.TRIAL
    ? resolvedPeriod
    : { start: legacyStart, end: monthEnd(legacyStart), source: RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK }

  let used = 0
  let reserved = 0
  if (reservationsEnabled || period.source === RESUME_QUOTA_PERIOD_SOURCES.TRIAL) {
    const snapshot = await getResumeQuotaUsageAvailabilitySnapshot({
      userId,
      periodStart: period.start,
      periodEnd: period.end,
      shouldResetUsage: usageOverride?.reset_usage,
      queryable: db,
    })
    used = snapshot.used
    reserved = snapshot.reserved
  } else if (!usageOverride?.reset_usage) {
    const usageResult = await db.query(
      `SELECT COUNT(*)::INT AS usage_count
       FROM usage_log
       WHERE user_id = $1
         AND (
           (quota_allocation_id IS NULL AND month_start = $2::date)
           OR (
             quota_allocation_id IS NOT NULL
             AND created_at >= $2
             AND created_at < $3
           )
         )`,
      [userId, period.start, period.end],
    )
    used = Number(usageResult.rows[0]?.usage_count || 0)
  }

  const remaining = Math.max(limit - used, 0)
  return {
    limit,
    used,
    reserved,
    available: canUsePaidMutation(account, now) ? Math.max(remaining - reserved, 0) : 0,
    canCreateAnalysis: canUsePaidMutation(account, now) && remaining > reserved,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
  }
}
