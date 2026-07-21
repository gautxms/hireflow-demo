import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateExperienceRange, normalizeExperienceYears } from './experienceRange.js'

test('evaluates decimal experience against inclusive 2-5 and 5-7 ranges', () => {
  for (const [range, cases] of [
    [{ min: 2, max: 5 }, [[1.9, 'below_range'], [2, 'within_range'], [3.5, 'within_range'], [4.5, 'within_range'], [5, 'within_range'], [5.1, 'above_range']]],
    [{ min: 5, max: 7 }, [[4.9, 'below_range'], [5, 'within_range'], [5.5, 'within_range'], [6.3, 'within_range'], [6.4, 'within_range'], [7, 'within_range'], [7.1, 'above_range']]],
  ]) {
    for (const [years, expected] of cases) assert.equal(evaluateExperienceRange(years, range).classification, expected)
  }
})

test('supports one-sided ranges, numeric strings, and unknown inputs without guessing text', () => {
  assert.equal(evaluateExperienceRange('3.5', { min: '2' }).classification, 'within_range')
  assert.equal(evaluateExperienceRange(4.5, { max: '4' }).classification, 'above_range')
  assert.equal(evaluateExperienceRange(null, { min: 2, max: 5 }).classification, 'unknown')
  assert.equal(evaluateExperienceRange(3.5, {}).classification, 'unknown')
  assert.equal(evaluateExperienceRange('about four years', { min: 2, max: 5 }).classification, 'unknown')
  assert.equal(evaluateExperienceRange(4, { min: 'invalid', max: 5 }).classification, 'unknown')
  assert.equal(normalizeExperienceYears('4 years 10 months'), null)
})
