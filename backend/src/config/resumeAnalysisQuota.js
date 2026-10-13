import { TIERED_PLAN_CATALOG } from './planCatalog.js'

export const PAID_MONTHLY_RESUME_ANALYSIS_LIMIT = 800
export const TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT = 10
export const RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT = 80

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
export const PAID_SUBSCRIPTION_STATUSES = new Set(['active'])
export const TRIAL_SUBSCRIPTION_STATUSES = new Set(['trial', 'trialing'])

export function hasPaidResumeAnalysisQuota(subscriptionStatus) {
  return PAID_SUBSCRIPTION_STATUSES.has(subscriptionStatus)
}

export function resolveMonthlyResumeAnalysisLimit(subscriptionStatus, usageOverride, subscriptionPlan = null) {
  const status = String(subscriptionStatus || '').trim().toLowerCase()
  // An admin override changes an existing entitlement; it cannot grant one.
  if (!hasPaidResumeAnalysisQuota(status) && !TRIAL_SUBSCRIPTION_STATUSES.has(status)) return 0
  if (usageOverride?.upload_limit && Number.isInteger(usageOverride.upload_limit)) {
    return usageOverride.upload_limit
  }

  return hasPaidResumeAnalysisQuota(status)
    ? (TIERED_PLAN_CATALOG[subscriptionPlan]?.monthlyResumeAnalysisLimit || PAID_MONTHLY_RESUME_ANALYSIS_LIMIT)
    : TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT
}
