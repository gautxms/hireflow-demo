import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAID_MONTHLY_RESUME_ANALYSIS_LIMIT,
  RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT,
  TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT,
  resolveMonthlyResumeAnalysisLimit,
} from './resumeAnalysisQuota.js'

test('resolveMonthlyResumeAnalysisLimit keeps active paid users on the 800 monthly allowance', () => {
  assert.equal(PAID_MONTHLY_RESUME_ANALYSIS_LIMIT, 800)
  assert.equal(resolveMonthlyResumeAnalysisLimit('active'), 800)
})

test('resolveMonthlyResumeAnalysisLimit keeps trial/free behavior unchanged', () => {
  assert.equal(TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT, 10)
  assert.equal(resolveMonthlyResumeAnalysisLimit('trialing'), 10)
  assert.equal(resolveMonthlyResumeAnalysisLimit('inactive'), 10)
})

test('resolveMonthlyResumeAnalysisLimit keeps admin override precedence', () => {
  assert.equal(resolveMonthlyResumeAnalysisLimit('active', { upload_limit: 2 }), 2)
  assert.equal(resolveMonthlyResumeAnalysisLimit('trialing', { upload_limit: 25 }), 25)
})

test('resume analysis warning threshold remains unchanged', () => {
  assert.equal(RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT, 80)
})
