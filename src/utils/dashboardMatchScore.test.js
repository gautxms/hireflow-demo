import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDashboardMatchScore } from './dashboardMatchScore.js'

test('dashboard match scores use the same ten-point display scale as analysis results', () => {
  assert.equal(formatDashboardMatchScore(87), '8.7')
  assert.equal(formatDashboardMatchScore(78), '7.8')
  assert.equal(formatDashboardMatchScore(0), '0.0')
  assert.equal(formatDashboardMatchScore(null), '—')
  assert.equal(formatDashboardMatchScore('invalid'), '—')
})
