import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatResumeQuotaRejection,
  formatResumeQuotaResetDate,
  getBatchQuotaGuidance,
  getResumeAllowanceTone,
  isResumeQuotaRejection,
  normalizeResumeAnalysisQuota,
  RESUME_ANALYSIS_QUOTA_EXCEEDED_CODE,
} from './resumeAnalysisQuota.js'

const periodEnd = '2026-08-20T08:30:00.000Z'

function quota(used, limit = 800, extra = {}) {
  return normalizeResumeAnalysisQuota({
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    available: Math.max(limit - used, 0),
    percentageUsed: Math.floor((used / limit) * 100),
    periodEnd,
    ...extra,
  })
}

test('valid zero usage is distinct from an incomplete or failed response', () => {
  assert.deepEqual(normalizeResumeAnalysisQuota(null), null)
  assert.deepEqual(normalizeResumeAnalysisQuota({ error: 'unavailable' }), null)
  assert.equal(quota(0).used, 0)
  assert.equal(quota(0).canCreateAnalysis, true)
})

test('allowance tones follow below-75, 75, 90, and 100 percent boundaries', () => {
  assert.equal(getResumeAllowanceTone(quota(599)), 'neutral')
  assert.equal(getResumeAllowanceTone(quota(600)), 'info')
  assert.equal(getResumeAllowanceTone(quota(720)), 'warning')
  assert.equal(getResumeAllowanceTone(quota(800)), 'reached')
})

test('799 of 800 permits one resume and 800 blocks submission', () => {
  assert.equal(quota(799).available, 1)
  assert.equal(quota(799).canCreateAnalysis, true)
  assert.equal(getBatchQuotaGuidance(quota(799), 1), '')
  assert.equal(quota(800).canCreateAnalysis, false)
  assert.match(getBatchQuotaGuidance(quota(800), 1), /0 resumes/)
})

test('server-provided creation decision overrides browser percentage', () => {
  assert.equal(quota(100, 800, { canCreateAnalysis: false, available: 20 }).canCreateAnalysis, false)
  assert.equal(getResumeAllowanceTone(quota(100, 800, { canCreateAnalysis: false, available: 20 })), 'reached')
  assert.equal(quota(800, 800, { canCreateAnalysis: true, available: 1 }).canCreateAnalysis, true)
})

test('reset dates render exactly when present and disappear when absent', () => {
  assert.equal(formatResumeQuotaResetDate(periodEnd), '20 August 2026')
  assert.equal(formatResumeQuotaResetDate(null), '')
})

test('trial-sized allowances use the same exact boundary behavior without inferring a plan', () => {
  assert.equal(getResumeAllowanceTone(quota(9, 10)), 'warning')
  assert.equal(quota(9, 10).canCreateAnalysis, true)
  assert.equal(quota(10, 10).canCreateAnalysis, false)
  assert.equal('plan' in quota(9, 10), false)
})

test('whole-batch guidance rejects oversized batches without changing selected files', () => {
  const selectedFiles = Object.freeze(['a.pdf', 'b.pdf', 'c.pdf'])
  assert.match(getBatchQuotaGuidance(quota(798), selectedFiles.length), /2 resumes/)
  assert.deepEqual(selectedFiles, ['a.pdf', 'b.pdf', 'c.pdf'])
})

test('only the stable quota code classifies a 429 as quota exhaustion', () => {
  assert.equal(isResumeQuotaRejection({ status: 429, code: RESUME_ANALYSIS_QUOTA_EXCEEDED_CODE }), true)
  assert.equal(isResumeQuotaRejection({ status: 429, code: 'RATE_LIMITED' }), false)
  assert.equal(isResumeQuotaRejection({ status: 429 }), false)
})

test('quota rejection produces allowance guidance rather than a network failure', () => {
  const message = formatResumeQuotaRejection({
    code: RESUME_ANALYSIS_QUOTA_EXCEEDED_CODE,
    limit: 800,
    used: 795,
    remaining: 5,
    periodEnd,
  })
  assert.match(message, /submit 5 resumes/)
  assert.match(message, /20 August 2026/)
  assert.doesNotMatch(message, /network/i)
})

test('older and partial successful responses receive safe availability fallbacks', () => {
  const legacy = normalizeResumeAnalysisQuota({ limit: 800, used: 12, periodEnd })
  assert.equal(legacy.remaining, 788)
  assert.equal(legacy.available, 788)
  assert.equal(legacy.canCreateAnalysis, true)
  assert.equal(legacy.percentageUsed, 1)
  assert.equal(legacy.nextRevalidationAt, periodEnd)
})

test('active-reservation availability can be lower than consumed remaining', () => {
  const result = normalizeResumeAnalysisQuota({ limit: 800, used: 790, remaining: 10, available: 5, canCreateAnalysis: true })
  assert.equal(result.remaining, 10)
  assert.equal(result.available, 5)
  assert.match(getBatchQuotaGuidance(result, 6), /5 resumes/)
})
