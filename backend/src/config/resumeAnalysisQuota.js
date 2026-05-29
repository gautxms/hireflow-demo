export const PAID_MONTHLY_RESUME_ANALYSIS_LIMIT = 800
export const TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT = 10
export const RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT = 80

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
export const PAID_SUBSCRIPTION_STATUSES = new Set(['active'])

export function hasPaidResumeAnalysisQuota(subscriptionStatus) {
  return PAID_SUBSCRIPTION_STATUSES.has(subscriptionStatus)
}

export function resolveMonthlyResumeAnalysisLimit(subscriptionStatus, usageOverride) {
  if (usageOverride?.upload_limit && Number.isInteger(usageOverride.upload_limit)) {
    return usageOverride.upload_limit
  }

  return hasPaidResumeAnalysisQuota(subscriptionStatus)
    ? PAID_MONTHLY_RESUME_ANALYSIS_LIMIT
    : TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT
}
