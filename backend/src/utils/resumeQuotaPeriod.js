const BILLING_ANCHOR_SOURCE = 'billing_anchor'
const CALENDAR_FALLBACK_SOURCE = 'calendar_month_fallback'

function toValidDate(value) {
  if (!value) return null

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function getDaysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function addUtcMonthsClamped(value, monthsToAdd) {
  const date = toValidDate(value)
  if (!date || !Number.isInteger(monthsToAdd)) return null

  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + monthsToAdd
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12
  const targetDay = Math.min(date.getUTCDate(), getDaysInUtcMonth(targetYear, targetMonth))

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ))
}

export function getCalendarMonthQuotaPeriod(referenceDate = new Date()) {
  const reference = toValidDate(referenceDate) || new Date()
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1))
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1))

  return {
    start,
    end,
    source: CALENDAR_FALLBACK_SOURCE,
    anchor: null,
  }
}

export function resolveResumeQuotaPeriod({
  subscriptionStatus,
  quotaAnchorAt,
  referenceDate = new Date(),
} = {}) {
  const reference = toValidDate(referenceDate) || new Date()
  const fallback = getCalendarMonthQuotaPeriod(reference)
  const normalizedStatus = String(subscriptionStatus || '').trim().toLowerCase()

  if (normalizedStatus !== 'active') {
    return { ...fallback, fallbackReason: 'non_paid_status' }
  }

  const anchor = toValidDate(quotaAnchorAt)

  if (!anchor) {
    return { ...fallback, fallbackReason: 'missing_billing_anchor' }
  }

  const futureDistance = anchor.getTime() - reference.getTime()
  if (futureDistance > 400 * 24 * 60 * 60 * 1000) {
    return { ...fallback, fallbackReason: 'billing_anchor_too_far_in_future' }
  }

  let monthOffset = (
    (reference.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + reference.getUTCMonth()
    - anchor.getUTCMonth()
  )
  let start = addUtcMonthsClamped(anchor, monthOffset)

  if (start.getTime() > reference.getTime()) {
    monthOffset -= 1
    start = addUtcMonthsClamped(anchor, monthOffset)
  }

  let end = addUtcMonthsClamped(anchor, monthOffset + 1)

  if (end.getTime() <= reference.getTime()) {
    monthOffset += 1
    start = end
    end = addUtcMonthsClamped(anchor, monthOffset + 1)
  }

  return {
    start,
    end,
    source: BILLING_ANCHOR_SOURCE,
    anchor,
  }
}

export function isResumeQuotaBillingPeriodShadowEnabled(env = process.env) {
  return String(env.RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE || 'true').trim().toLowerCase() !== 'false'
}

export const RESUME_QUOTA_PERIOD_SOURCES = Object.freeze({
  BILLING_ANCHOR: BILLING_ANCHOR_SOURCE,
  CALENDAR_FALLBACK: CALENDAR_FALLBACK_SOURCE,
})
