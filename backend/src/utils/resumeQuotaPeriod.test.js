import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addUtcMonthsClamped,
  getCalendarMonthQuotaPeriod,
  isResumeQuotaBillingPeriodShadowEnabled,
  resolveResumeQuotaPeriod,
  RESUME_QUOTA_PERIOD_SOURCES,
} from './resumeQuotaPeriod.js'

test('addUtcMonthsClamped preserves the billing time and clamps short months', () => {
  assert.equal(
    addUtcMonthsClamped('2026-01-31T14:45:10.123Z', 1).toISOString(),
    '2026-02-28T14:45:10.123Z',
  )
  assert.equal(
    addUtcMonthsClamped('2026-01-31T14:45:10.123Z', 2).toISOString(),
    '2026-03-31T14:45:10.123Z',
  )
})

test('resolveResumeQuotaPeriod uses the paid subscription anniversary for monthly plans', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'active',
    quotaAnchorAt: '2026-01-20T08:30:00.000Z',
    referenceDate: '2026-07-23T12:00:00.000Z',
  })

  assert.equal(period.source, RESUME_QUOTA_PERIOD_SOURCES.BILLING_ANCHOR)
  assert.equal(period.start.toISOString(), '2026-07-20T08:30:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-20T08:30:00.000Z')
  assert.equal(period.anchor.toISOString(), '2026-01-20T08:30:00.000Z')
})

test('resolveResumeQuotaPeriod gives annual subscribers monthly allowance windows from one anchor', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'active',
    quotaAnchorAt: '2025-11-15T00:00:00.000Z',
    referenceDate: '2026-07-23T12:00:00.000Z',
  })

  assert.equal(period.start.toISOString(), '2026-07-15T00:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-15T00:00:00.000Z')
})

test('resolveResumeQuotaPeriod rolls to a new period exactly at the anniversary boundary', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'active',
    quotaAnchorAt: '2026-01-20T08:30:00.000Z',
    referenceDate: '2026-07-20T08:30:00.000Z',
  })

  assert.equal(period.start.toISOString(), '2026-07-20T08:30:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-20T08:30:00.000Z')
})

test('resolveResumeQuotaPeriod keeps calendar-month fallback for legacy users missing billing data', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'active',
    referenceDate: '2026-07-23T12:00:00.000Z',
  })

  assert.equal(period.source, RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK)
  assert.equal(period.fallbackReason, 'missing_billing_anchor')
  assert.equal(period.start.toISOString(), '2026-07-01T00:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-01T00:00:00.000Z')
})

test('resolveResumeQuotaPeriod does not move trial users away from calendar-month accounting', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'trialing',
    quotaAnchorAt: '2026-01-20T08:30:00.000Z',
    referenceDate: '2026-07-23T12:00:00.000Z',
  })

  assert.equal(period.source, RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK)
  assert.equal(period.fallbackReason, 'non_paid_status')
})

test('a known future annual boundary resolves the current monthly allowance window', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'active',
    quotaAnchorAt: '2027-07-20T08:30:00.000Z',
    referenceDate: '2026-07-23T12:00:00.000Z',
  })

  assert.equal(period.source, RESUME_QUOTA_PERIOD_SOURCES.BILLING_ANCHOR)
  assert.equal(period.start.toISOString(), '2026-07-20T08:30:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-20T08:30:00.000Z')
})

test('implausibly distant future anchors safely fall back', () => {
  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: 'active',
    quotaAnchorAt: '2028-08-20T08:30:00.000Z',
    referenceDate: '2026-07-23T12:00:00.000Z',
  })

  assert.equal(period.source, RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK)
  assert.equal(period.fallbackReason, 'billing_anchor_too_far_in_future')
})

test('calendar helper and shadow flag retain safe defaults', () => {
  const period = getCalendarMonthQuotaPeriod('2026-12-31T23:59:59.999Z')

  assert.equal(period.start.toISOString(), '2026-12-01T00:00:00.000Z')
  assert.equal(period.end.toISOString(), '2027-01-01T00:00:00.000Z')
  assert.equal(isResumeQuotaBillingPeriodShadowEnabled({}), true)
  assert.equal(isResumeQuotaBillingPeriodShadowEnabled({ RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE: 'false' }), false)
})
