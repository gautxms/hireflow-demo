import { hasAnalyticsConsent } from './cookieConsent'

const ALLOWED_EVENT_NAMES = new Set([
  'landing_cta_clicked',
  'pricing_viewed',
  'signup_started',
  'login_clicked',
  'analysis_created',
  'resume_upload_started',
  'analysis_completed',
  'shortlist_created',
  'intent_landing_view',
])

const UNSAFE_PAYLOAD_KEY_PATTERN = /(candidate|resume|email|phone|filename|file_name|name|reasoning|job_description|description|text|content)/i

function isBrowser() {
  return typeof window !== 'undefined'
}

function sanitizePayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }

  return Object.entries(payload).reduce((safePayload, [key, value]) => {
    if (UNSAFE_PAYLOAD_KEY_PATTERN.test(key)) {
      return safePayload
    }

    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      safePayload[key] = value
    }

    return safePayload
  }, {})
}

export function canTrackAnalytics() {
  return isBrowser() && hasAnalyticsConsent()
}

export function trackEvent(eventName, payload = {}) {
  if (!ALLOWED_EVENT_NAMES.has(eventName) || !canTrackAnalytics()) {
    return false
  }

  const safePayload = sanitizePayload(payload)

  // TODO: Wire a privacy-conscious analytics provider here after vendor review.
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event: eventName, ...safePayload })

  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, safePayload)
  }

  return true
}
