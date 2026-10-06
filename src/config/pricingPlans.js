// Public offers use the existing Pro checkout codes and Paddle prices.
// The six tiered codes remain supported by the backend for stored subscriptions.
export const PRICING_TIERS = Object.freeze([
  { id: 'starter', name: 'Starter', monthlyLimit: 100, monthlyAmount: 29, annualAmount: 290, monthlyCode: 'starter_monthly', annualCode: 'starter_annual' },
  { id: 'growth', name: 'Growth', monthlyLimit: 300, monthlyAmount: 59, annualAmount: 590, monthlyCode: 'growth_monthly', annualCode: 'growth_annual' },
  { id: 'pro', name: 'Pro', monthlyLimit: 800, monthlyAmount: 99, annualAmount: 999, monthlyCode: 'monthly', annualCode: 'annual' },
])

export const CHECKOUT_PLAN_DETAILS = Object.freeze(Object.fromEntries([
  ...PRICING_TIERS.flatMap((tier) => [
    [tier.monthlyCode, { label: `${tier.name} Monthly`, price: `$${tier.monthlyAmount}/month`, monthlyLimit: tier.monthlyLimit }],
    [tier.annualCode, { label: `${tier.name} Annual`, price: `$${tier.annualAmount}/year`, monthlyLimit: tier.monthlyLimit }],
  ]),
  ['pro_monthly', { label: 'Pro Monthly', price: '$99/month', monthlyLimit: 800 }],
  ['pro_annual', { label: 'Pro Annual', price: '$999/year', monthlyLimit: 800 }],
  ['test-monthly', { label: 'Monthly', price: '', monthlyLimit: 800 }],
]))

const PUBLIC_CHECKOUT_CODES = new Set([
  ...PRICING_TIERS.flatMap((tier) => [tier.monthlyCode, tier.annualCode]),
  'test-monthly',
])

export function getCheckoutPlanFromSearch(search) {
  const code = new URLSearchParams(search).get('plan')
  return PUBLIC_CHECKOUT_CODES.has(code) ? code : null
}

export function getPlanDisplayLabel(code) {
  return CHECKOUT_PLAN_DETAILS[code]?.label || ''
}
