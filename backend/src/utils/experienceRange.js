const DECIMAL_NUMBER = /^\s*\d+(?:\.\d+)?\s*$/

export function normalizeExperienceYears(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value !== 'string' || !DECIMAL_NUMBER.test(value)) return null
  const numeric = Number(value.trim())
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

export function evaluateExperienceRange(candidateExperience, range = {}) {
  const candidateYears = normalizeExperienceYears(candidateExperience)
  const minimumYears = normalizeExperienceYears(range?.min)
  const maximumYears = normalizeExperienceYears(range?.max)
  const hasMinimum = range?.min !== null && range?.min !== undefined && range?.min !== ''
  const hasMaximum = range?.max !== null && range?.max !== undefined && range?.max !== ''

  if (candidateYears === null || (!hasMinimum && !hasMaximum)) {
    return { classification: 'unknown', candidateYears, minimumYears, maximumYears }
  }
  if ((hasMinimum && minimumYears === null) || (hasMaximum && maximumYears === null) || (minimumYears !== null && maximumYears !== null && minimumYears > maximumYears)) {
    return { classification: 'unknown', candidateYears, minimumYears, maximumYears }
  }
  if (minimumYears !== null && candidateYears < minimumYears) {
    return { classification: 'below_range', candidateYears, minimumYears, maximumYears }
  }
  if (maximumYears !== null && candidateYears > maximumYears) {
    return { classification: 'above_range', candidateYears, minimumYears, maximumYears }
  }
  return { classification: 'within_range', candidateYears, minimumYears, maximumYears }
}
