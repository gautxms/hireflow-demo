import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
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

function deriveAnalysisStatus(row) {
  const total = Number(row.total_count || 0)
  const complete = Number(row.complete_count || 0)
  const failed = Number(row.failed_count || 0)
  const processing = Number(row.processing_count || 0)

  if (total === 0) return row.status === 'failed' ? 'failed' : 'queued'
  if (complete + failed === total) return failed > 0 ? 'failed' : 'complete'
  if (processing > 0) return 'processing'
  return 'queued'
}

function parseResultObject(value, depth = 0) {
  if (depth > 4 || value == null) return null
  if (typeof value === 'string') {
    try {
      return parseResultObject(JSON.parse(value), depth + 1)
    } catch {
      return null
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : null
}

function extractResultCandidates(value) {
  const result = parseResultObject(value)
  if (!result) return []

  for (const candidateValue of [result.candidates, result.results, result.output]) {
    if (Array.isArray(candidateValue)) return candidateValue
    const nested = parseResultObject(candidateValue)
    if (Array.isArray(nested?.candidates)) return nested.candidates
  }
  return []
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

export async function getMcpAnalysisStatus({ db, userId, analysisId }) {
  const result = await db.query(
    `SELECT a.id,
            a.name,
            a.status,
            a.created_at,
            a.completed_at,
            a.job_description_id,
            jd.title AS job_description_title,
            COUNT(ai.id)::INT AS total_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') = 'complete'
            )::INT AS complete_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') IN ('failed', 'stalled')
            )::INT AS failed_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') IN ('processing', 'retrying')
            )::INT AS processing_count,
            COUNT(ai.id) FILTER (
              WHERE COALESCE(pj.status, r.parse_status, 'queued') IN ('queued', 'pending', 'waiting')
            )::INT AS queued_count
     FROM analyses a
     LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id
     LEFT JOIN analysis_items ai ON ai.analysis_id = a.id
     LEFT JOIN resumes r ON r.id = ai.resume_id
     LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
     WHERE a.id = $1 AND a.user_id = $2
     GROUP BY a.id, jd.title
     LIMIT 1`,
    [analysisId, userId],
  )
  const row = result.rows[0]
  if (!row) return null

  const counts = {
    total: Number(row.total_count || 0),
    complete: Number(row.complete_count || 0),
    failed: Number(row.failed_count || 0),
    processing: Number(row.processing_count || 0),
    queued: Number(row.queued_count || 0),
  }
  const uploadResult = await db.query(
    `SELECT uc.status, uc.updated_at
     FROM upload_chunks uc
     WHERE uc.analysis_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM analysis_items ai
         LEFT JOIN resumes r ON r.id = ai.resume_id
         WHERE ai.analysis_id = uc.analysis_id
           AND (
             (uc.resume_id IS NOT NULL AND ai.resume_id = uc.resume_id)
             OR (uc.parse_job_id IS NOT NULL AND ai.parse_job_id = uc.parse_job_id)
             OR (LOWER(TRIM(COALESCE(uc.filename, ''))) <> ''
                 AND LOWER(TRIM(COALESCE(r.original_filename, r.filename, '')))
                   = LOWER(TRIM(uc.filename)))
           )
       )`,
    [analysisId],
  )
  for (const upload of uploadResult.rows) {
    const uploadStatus = String(upload.status || '').toLowerCase()
    const updatedAt = upload.updated_at ? new Date(upload.updated_at) : null
    const stale = uploadStatus === 'uploading'
      && updatedAt
      && !Number.isNaN(updatedAt.getTime())
      && Date.now() - updatedAt.getTime() > 30 * 60 * 1000
    const status = ['failed', 'rejected', 'expired'].includes(uploadStatus) || stale
      ? 'failed'
      : 'processing'
    counts.total += 1
    counts[status] += 1
  }

  return {
    id: String(row.id),
    name: row.name || 'Untitled analysis',
    status: deriveAnalysisStatus({
      ...row,
      total_count: counts.total,
      complete_count: counts.complete,
      failed_count: counts.failed,
      processing_count: counts.processing,
    }),
    job: row.job_description_id
      ? { id: String(row.job_description_id), title: row.job_description_title || 'Untitled job' }
      : null,
    counts,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  }
}

export async function getMcpAnalysisResults({ db, userId, analysisId }) {
  const status = await getMcpAnalysisStatus({ db, userId, analysisId })
  if (!status) return null

  const result = await db.query(
    `SELECT ai.id,
            ai.resume_id,
            r.filename,
            r.original_filename,
            COALESCE(pj.status, r.parse_status, 'queued') AS item_status,
            pj.result AS parse_result
     FROM analysis_items ai
     INNER JOIN analyses a ON a.id = ai.analysis_id AND a.user_id = $2
     LEFT JOIN resumes r ON r.id = ai.resume_id
     LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
     WHERE ai.analysis_id = $1
     ORDER BY ai.created_at ASC`,
    [analysisId, userId],
  )

  const candidates = []
  const failures = []
  for (const row of result.rows) {
    const filename = row.original_filename || row.filename || 'Unknown file'
    const itemStatus = String(row.item_status || '').toLowerCase()
    if (['failed', 'stalled'].includes(itemStatus)) {
      failures.push({
        filename,
        reason: 'HireFlow could not analyse this resume.',
      })
    }

    const extractedCandidates = extractResultCandidates(row.parse_result)
    extractedCandidates.forEach((candidate, index) => {
      const normalized = normalizeMcpCandidateResult(candidate, {
        resumeId: String(row.resume_id || ''),
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
    failures,
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
