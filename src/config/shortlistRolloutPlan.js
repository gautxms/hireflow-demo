export const SHORTLIST_ROLLOUT_PHASES = Object.freeze([
  Object.freeze({ key: 'internal', label: 'Internal dogfood', rolloutPercent: 0 }),
  Object.freeze({ key: 'cohort_10', label: '10% cohort', rolloutPercent: 10 }),
  Object.freeze({ key: 'cohort_50', label: '50% cohort', rolloutPercent: 50 }),
  Object.freeze({ key: 'cohort_100', label: '100% rollout', rolloutPercent: 100 }),
])

export const SHORTLIST_ROLLOUT_KPIS = Object.freeze([
  'shortlist_add_success_rate',
  'wrong_destination_correction_rate',
  'shortlist_page_engagement',
  'analysis_results_add_to_shortlist_conversion',
])

export function getShortlistRolloutPhaseByPercent(rolloutPercent) {
  const safePercent = Number.isFinite(Number(rolloutPercent))
    ? Math.max(0, Math.min(100, Number(rolloutPercent)))
    : 0

  for (let index = SHORTLIST_ROLLOUT_PHASES.length - 1; index >= 0; index -= 1) {
    const phase = SHORTLIST_ROLLOUT_PHASES[index]
    if (safePercent >= phase.rolloutPercent) {
      return phase
    }
  }

  return SHORTLIST_ROLLOUT_PHASES[0]
}

export function getNextShortlistRolloutPhase(currentPhaseKey) {
  const currentIndex = SHORTLIST_ROLLOUT_PHASES.findIndex((phase) => phase.key === currentPhaseKey)

  if (currentIndex === -1) {
    return SHORTLIST_ROLLOUT_PHASES[0]
  }

  return SHORTLIST_ROLLOUT_PHASES[Math.min(currentIndex + 1, SHORTLIST_ROLLOUT_PHASES.length - 1)]
}
