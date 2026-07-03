export function getBillingPlanAction(plan) {
  if (plan === 'monthly') {
    return {
      kind: 'upgrade',
      targetPlan: 'annual',
      label: 'Upgrade to annual',
      isSelfServe: true,
    }
  }

  if (plan === 'annual') {
    return {
      kind: 'support-assisted-cadence-change',
      targetPlan: 'monthly',
      label: 'Need monthly billing? Contact support and we’ll help update your billing cadence safely.',
      isSelfServe: false,
    }
  }

  return null
}

export function getCancelActionLabel(plan) {
  return plan === 'annual' ? 'Cancel renewal' : 'Cancel subscription'
}
