import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboardSource = readFileSync(new URL('./NewDashboard.jsx', import.meta.url), 'utf8')

test('average score trend renders with any valid scored trend point', () => {
  assert.match(dashboardSource, /const validScorePointCount = scoreSummary\.scoredPoints\.length/)
  assert.match(dashboardSource, /const showScoreChart = fetchState === 'success' && validScorePointCount > 0/)
  assert.doesNotMatch(dashboardSource, /hasSparseScoreData/)
  assert.doesNotMatch(dashboardSource, /Not enough score data yet/)
})

test('average score trend uses true empty state only when no valid score points exist', () => {
  assert.match(dashboardSource, /const isScoreEmpty = fetchState === 'success' && validScorePointCount === 0/)
  assert.match(dashboardSource, /No completed score data is available for the selected filters\./)
})

test('average score trend plots scored points against the score axis and skips missing point markers', () => {
  assert.match(dashboardSource, /function buildScoreChartPoints\(series, axisMin, axisMax\)/)
  assert.match(dashboardSource, /const boundedPercent = hasData \? \(\(value - safeMin\) \/ range\) \* 100 : null/)
  assert.match(dashboardSource, /averageScorePoints\.filter\(\(point\) => point\.hasData\)\.map/)
  assert.doesNotMatch(dashboardSource, /bottom: `\$\{bar\.hasData \? bar\.height : 6\}%`/)
})


test('analyses trend uses dense bar layout for long ranges such as 90 days', () => {
  assert.match(dashboardSource, /const isAnalysesChartDense = analysesBars\.length > 45/)
  assert.match(dashboardSource, /isAnalysesChartDense \? 'new-dashboard__chart--dense' : ''/)
})
