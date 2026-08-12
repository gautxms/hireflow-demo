const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PENDING_VERIFICATION_EMAIL_STORAGE_KEY = 'hireflow_pending_verification_email'

function getDefaultSessionStorage() {
  try {
    return globalThis.sessionStorage || null
  } catch {
    return null
  }
}

export function normalizePendingVerificationEmail(email) {
  if (typeof email !== 'string') {
    return ''
  }

  const normalizedEmail = email.trim().toLowerCase()
  return EMAIL_REGEX.test(normalizedEmail) ? normalizedEmail : ''
}

export function readPendingVerificationEmail(storage = getDefaultSessionStorage()) {
  if (!storage) {
    return ''
  }

  try {
    return normalizePendingVerificationEmail(storage.getItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY))
  } catch {
    return ''
  }
}

export function storePendingVerificationEmail(email, storage = getDefaultSessionStorage()) {
  const normalizedEmail = normalizePendingVerificationEmail(email)

  if (!storage) {
    return normalizedEmail
  }

  try {
    if (normalizedEmail) {
      storage.setItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY, normalizedEmail)
    } else {
      storage.removeItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY)
    }
  } catch {
    // The in-memory route state still carries the email when storage is unavailable.
  }

  return normalizedEmail
}

export function clearPendingVerificationEmail(storage = getDefaultSessionStorage()) {
  if (!storage) {
    return
  }

  try {
    storage.removeItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY)
  } catch {
    // Ignore unavailable or blocked session storage.
  }
}
