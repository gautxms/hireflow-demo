const SUSPICIOUS_PATTERN = /(<script\b|javascript:|on\w+\s*=|\b(select|insert|update|delete|drop|union|truncate|--|;|\/\*)\b)/i

export function sanitizeText(value) {
  if (typeof value !== 'string') return ''

  return value
    .normalize('NFKC')
    .replace(/[<>"'`]/g, '')
    .trim()
}

export function sanitizeEmail(value) {
  return sanitizeText(value).toLowerCase()
}

export function sanitizeCompany(value) {
  return sanitizeText(value).replace(/[^a-zA-Z0-9\-\s]/g, '').slice(0, 100)
}

export function sanitizePhone(value) {
  return sanitizeText(value).replace(/\s+/g, '')
}

export function sanitizeFilename(value) {
  const sanitized = sanitizeText(value)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return sanitized || 'resume'
}

export function hasSuspiciousPattern(value) {
  if (typeof value !== 'string') return false
  return SUSPICIOUS_PATTERN.test(value)
}
