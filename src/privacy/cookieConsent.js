export const COOKIE_CONSENT_VERSION = 1
export const COOKIE_CONSENT_STORAGE_KEY = 'hireflow_cookie_consent_v1'
export const COOKIE_PREFERENCES_EVENT = 'hireflow-cookie-preferences-open'

export const DEFAULT_COOKIE_CONSENT = Object.freeze({
  necessary: true,
  analytics: false,
  marketing: false,
  version: COOKIE_CONSENT_VERSION,
  timestamp: '',
})

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function normalizeConsent(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (Number(value.version) !== COOKIE_CONSENT_VERSION) {
    return null
  }

  return {
    necessary: true,
    analytics: Boolean(value.analytics),
    marketing: Boolean(value.marketing),
    version: COOKIE_CONSENT_VERSION,
    timestamp: typeof value.timestamp === 'string' && value.timestamp ? value.timestamp : new Date().toISOString(),
  }
}

export function readCookieConsent() {
  if (!isBrowser()) {
    return null
  }

  try {
    const rawConsent = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)
    if (!rawConsent) {
      return null
    }

    return normalizeConsent(JSON.parse(rawConsent))
  } catch {
    return null
  }
}

export function writeCookieConsent(preferences) {
  const consent = {
    ...DEFAULT_COOKIE_CONSENT,
    ...preferences,
    necessary: true,
    version: COOKIE_CONSENT_VERSION,
    timestamp: new Date().toISOString(),
  }

  if (!isBrowser()) {
    return consent
  }

  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent))
    window.dispatchEvent(new CustomEvent('hireflow-cookie-consent-updated', { detail: consent }))
  } catch {
    // Consent should not break the app if storage is unavailable.
  }

  return consent
}

export function hasAnalyticsConsent(consent = readCookieConsent()) {
  return Boolean(consent?.necessary && consent?.analytics)
}

export function hasMarketingConsent(consent = readCookieConsent()) {
  return Boolean(consent?.necessary && consent?.marketing)
}

export function openCookiePreferences() {
  if (!isBrowser()) {
    return
  }

  window.dispatchEvent(new CustomEvent(COOKIE_PREFERENCES_EVENT))
}
