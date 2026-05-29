import { normalizeCandidateFieldArray } from './candidateStructuredFields.js'

export function normalizeCandidateEducation(value, { maxItems = 20, maxItemLength = 200 } = {}) {
  return normalizeCandidateFieldArray(value, { fieldName: 'education', maxItems, maxItemLength })
}

export function formatEducationForDisplay(value, fallback = '') {
  const labels = normalizeCandidateEducation(value).filter(Boolean)
  return labels.join(' | ') || fallback
}
