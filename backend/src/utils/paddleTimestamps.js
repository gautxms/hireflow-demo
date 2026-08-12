export function normalizePaddleTimestamp(value) {
  if (value === null || value === undefined || value === '') return null

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function firstNormalizedPaddleTimestamp(...values) {
  for (const value of values) {
    const normalized = normalizePaddleTimestamp(value)
    if (normalized) return normalized
  }
  return null
}
