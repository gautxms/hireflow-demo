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

test('paid tier limits apply to both billing intervals and legacy Pro plans', () => {
  for (const interval of ['monthly', 'annual']) {
    assert.equal(resolveMonthlyResumeAnalysisLimit('active', null, `starter_${interval}`), 100)
    assert.equal(resolveMonthlyResumeAnalysisLimit('active', null, `growth_${interval}`), 300)
    assert.equal(resolveMonthlyResumeAnalysisLimit('active', null, `pro_${interval}`), 800)
  }
  assert.equal(resolveMonthlyResumeAnalysisLimit('active', null, 'monthly'), 800)
  assert.equal(resolveMonthlyResumeAnalysisLimit('active', null, 'annual'), 800)
  assert.equal(resolveMonthlyResumeAnalysisLimit('trialing', null, 'starter_annual'), 10)
  assert.equal(resolveMonthlyResumeAnalysisLimit('active', { upload_limit: 150 }, 'starter_monthly'), 150)
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
