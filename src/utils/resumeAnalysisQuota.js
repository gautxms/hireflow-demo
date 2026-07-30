export const RESUME_ANALYSIS_QUOTA_EXCEEDED_CODE = 'RESUME_ANALYSIS_QUOTA_EXCEEDED'

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : null
}

export function normalizeResumeAnalysisQuota(payload) {
  if (!payload || typeof payload !== 'object') return null
  const limit = finiteNonNegative(payload.limit)
  const used = finiteNonNegative(payload.used)
  if (limit === null || used === null) return null
  const remaining = finiteNonNegative(payload.remaining) ?? Math.max(limit - used, 0)
  const available = finiteNonNegative(payload.available) ?? remaining
  const percentageUsed = finiteNonNegative(payload.percentageUsed)
    ?? (limit > 0 ? Math.floor((used / limit) * 100) : 0)
  const explicitAllowed = typeof payload.canCreateAnalysis === 'boolean'
    ? payload.canCreateAnalysis
    : null

  return {
    limit,
    used,
    remaining,
    available,
    percentageUsed,
    periodStart: typeof payload.periodStart === 'string' ? payload.periodStart : null,
    periodEnd: typeof payload.periodEnd === 'string' ? payload.periodEnd : null,
    warningLevel: typeof payload.warningLevel === 'string' ? payload.warningLevel : null,
    nextRevalidationAt: typeof payload.nextRevalidationAt === 'string'
      ? payload.nextRevalidationAt
      : (typeof payload.periodEnd === 'string' ? payload.periodEnd : null),
    canCreateAnalysis: explicitAllowed ?? available > 0,
  }
}

export function isResumeAnalysisAccessBlocked(quota) {
  return quota?.canCreateAnalysis === false && finiteNonNegative(quota?.available) > 0
}

export function getResumeAllowanceTone(quota) {
  if (!quota || isResumeAnalysisAccessBlocked(quota)) return 'unavailable'
  if (quota.canCreateAnalysis === false || quota.available <= 0 || quota.warningLevel === 'exceeded') return 'reached'
  if (quota.warningLevel === 'critical' || quota.percentageUsed >= 90) return 'warning'
  if (quota.warningLevel === 'approaching' || quota.percentageUsed >= 75) return 'info'
  return 'neutral'
}

export function formatResumeAnalysisCreationBlocked(quota) {
  if (isResumeAnalysisAccessBlocked(quota)) {
    return 'An active subscription is required to analyze new resumes. Existing analyses and results remain available.'
  }
  return formatResumeQuotaRejection({}, quota)
}

export function formatResumeQuotaResetDate(value, locale = 'en-GB') {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function isResumeQuotaRejection(errorOrPayload) {
  const payload = errorOrPayload?.quota || errorOrPayload
  return payload?.code === RESUME_ANALYSIS_QUOTA_EXCEEDED_CODE
}

export function formatResumeQuotaRejection(payload, fallbackQuota = null) {
  const quota = normalizeResumeAnalysisQuota({ ...fallbackQuota, ...payload }) || fallbackQuota
  const available = finiteNonNegative(payload?.available)
    ?? finiteNonNegative(payload?.remaining)
    ?? quota?.available
  const resetDate = formatResumeQuotaResetDate(payload?.periodEnd || quota?.periodEnd)
  const capacity = available === null || available === undefined
    ? 'This batch exceeds your resume allowance.'
    : `This batch exceeds your resume allowance. You can currently submit ${available} resume${available === 1 ? '' : 's'}.`
  return `${capacity}${resetDate ? ` Your allowance resets on ${resetDate}.` : ''}`
}

export function getBatchQuotaGuidance(quota, selectedCount) {
  if (!quota || !Number.isFinite(Number(selectedCount)) || selectedCount <= quota.available) return ''
  return `This batch exceeds your resume allowance. You can currently submit ${quota.available} resume${quota.available === 1 ? '' : 's'}.`
}
