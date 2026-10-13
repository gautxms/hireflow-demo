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

test('only trial and trialing receive the 10-analysis entitlement', () => {
  assert.equal(TRIAL_MONTHLY_RESUME_ANALYSIS_LIMIT, 10)
  for (const status of ['trial', 'trialing']) {
    assert.equal(resolveMonthlyResumeAnalysisLimit(status), 10)
  }
  for (const status of ['canceled', 'cancelled', 'inactive', 'expired', 'past_due', 'payment_failed', 'paused', 'no_subscription', 'none', 'free', null]) {
    assert.equal(resolveMonthlyResumeAnalysisLimit(status), 0, String(status))
    assert.equal(resolveMonthlyResumeAnalysisLimit(status, { upload_limit: 25 }), 0, String(status))
  }
})

test('resolveMonthlyResumeAnalysisLimit keeps admin override precedence', () => {
  assert.equal(resolveMonthlyResumeAnalysisLimit('active', { upload_limit: 2 }), 2)
  assert.equal(resolveMonthlyResumeAnalysisLimit('trialing', { upload_limit: 25 }), 25)
})

test('resume analysis warning threshold remains unchanged', () => {
  assert.equal(RESUME_ANALYSIS_USAGE_WARNING_THRESHOLD_PERCENT, 80)
})
