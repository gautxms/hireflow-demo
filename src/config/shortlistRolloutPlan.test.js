import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SHORTLIST_ROLLOUT_KPIS,
  SHORTLIST_ROLLOUT_PHASES,
  getNextShortlistRolloutPhase,
  getShortlistRolloutPhaseByPercent,
} from './shortlistRolloutPlan.js'

test('shortlist rollout phases preserve required progression', () => {
  assert.deepEqual(
    SHORTLIST_ROLLOUT_PHASES.map((phase) => phase.rolloutPercent),
    [0, 10, 50, 100],
  )
})

test('shortlist rollout kpis include required monitoring metrics', () => {
  assert.deepEqual(SHORTLIST_ROLLOUT_KPIS, [
    'shortlist_add_success_rate',
    'wrong_destination_correction_rate',
    'shortlist_page_engagement',
    'analysis_results_add_to_shortlist_conversion',
  ])
})

test('rollout phase resolver maps percentages to expected phase', () => {
  assert.equal(getShortlistRolloutPhaseByPercent(0).key, 'internal')
  assert.equal(getShortlistRolloutPhaseByPercent(10).key, 'cohort_10')
  assert.equal(getShortlistRolloutPhaseByPercent(49).key, 'cohort_10')
  assert.equal(getShortlistRolloutPhaseByPercent(50).key, 'cohort_50')
  assert.equal(getShortlistRolloutPhaseByPercent(100).key, 'cohort_100')
})

test('next rollout phase helper advances safely and caps at 100%', () => {
  assert.equal(getNextShortlistRolloutPhase('internal').key, 'cohort_10')
  assert.equal(getNextShortlistRolloutPhase('cohort_10').key, 'cohort_50')
  assert.equal(getNextShortlistRolloutPhase('cohort_50').key, 'cohort_100')
  assert.equal(getNextShortlistRolloutPhase('cohort_100').key, 'cohort_100')
})
