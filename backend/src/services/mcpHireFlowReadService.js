import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import { buildAnalysisDetailPayload, loadAnalysisReadModel } from './analysisReadModelService.js'
import {
  getResumeQuotaUsageAvailabilitySnapshot,
  isResumeQuotaReservationsEnabled,
} from './resumeQuotaReservations.js'
import { resolveResumeQuotaPeriod, RESUME_QUOTA_PERIOD_SOURCES } from '../utils/resumeQuotaPeriod.js'
import { canUsePaidMutation, hasScheduledCancellationAccess } from '../utils/subscriptionAccess.js'

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

function displayValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return optionalText(value)
  }
  if (Array.isArray(value)) return optionalText(value.map(displayValue).filter(Boolean).join(', '))
  if (typeof value === 'object') {
    return optionalText(Object.entries(value)
      .map(([key, entry]) => {
        const normalized = displayValue(entry)
        return normalized ? `${key}: ${normalized}` : null
      })
      .filter(Boolean)
      .join('; '))
  }
  return null
}

function humanizeKey(value) {
  const normalized = String(value || '').replace(/[_-]+/g, ' ').trim()
  return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Detail'
}

function normalizeBreakdown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, rawValue]) => {
    const normalized = displayValue(rawValue)
    return normalized ? [{ key, label: humanizeKey(key), value: normalized }] : []
  })
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
  const reason = optionalText(matchScore.reason || fitAssessment.rationale)
  const summary = optionalText(candidate.summaryFull || candidate.summary || candidate.profile_summary)

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
    score,
    scoreOutOfTen,
    verdict: optionalText(candidate.verdict || matchScore.fit),
    summary,
    reason,
    recommendation: optionalText(candidate.recommendationFull || candidate.recommendation || reason),
    strengths: textArray(candidate.strengthsFull || candidate.strengths),
    considerations: textArray(candidate.considerations || candidate.concerns),
    matchedRequirements: textArray(candidate.matchedRequirementsFull || fitAssessment.matched_requirements),
    missingRequirements: textArray(candidate.missingRequirementsFull || fitAssessment.missing_requirements),
    risksOrGaps: textArray(candidate.risksOrGapsFull || fitAssessment.risks_or_gaps),
    skills: normalizeSkills(candidate),
    experienceHighlights: textArray(candidate.experienceHighlights || candidate.experience_highlights),
    breakdown: normalizeBreakdown(matchScore.breakdown || candidate.scoreBreakdown?.categories),
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
