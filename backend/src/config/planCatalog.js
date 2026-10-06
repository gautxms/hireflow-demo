// Existing monthly/annual subscribers retain their Pro allowance and price identity.
export const LEGACY_PLAN_CODES = ['monthly', 'annual']

export const TIERED_PLAN_CATALOG = Object.freeze({
  starter_monthly: { tier: 'Starter', interval: 'month', amountCents: 2900, monthlyResumeAnalysisLimit: 100 },
  starter_annual: { tier: 'Starter', interval: 'year', amountCents: 29000, monthlyResumeAnalysisLimit: 100 },
  growth_monthly: { tier: 'Growth', interval: 'month', amountCents: 5900, monthlyResumeAnalysisLimit: 300 },
  growth_annual: { tier: 'Growth', interval: 'year', amountCents: 59000, monthlyResumeAnalysisLimit: 300 },
  pro_monthly: { tier: 'Pro', interval: 'month', amountCents: 9900, monthlyResumeAnalysisLimit: 800 },
  pro_annual: { tier: 'Pro', interval: 'year', amountCents: 99900, monthlyResumeAnalysisLimit: 800 },
})

export const TIERED_PLAN_CODES = Object.keys(TIERED_PLAN_CATALOG)
export const PAID_PLAN_CODES = [...LEGACY_PLAN_CODES, ...TIERED_PLAN_CODES]

export function getPlanBillingInterval(plan) {
  if (plan === 'monthly') return 'month'
  if (plan === 'annual') return 'year'
  return TIERED_PLAN_CATALOG[plan]?.interval || null
}
