const IMPORTABLE_FIELDS = [
  'title',
  'description',
  'responsibilities',
  'requirements',
  'skills',
  'location',
  'experienceMin',
  'experienceMax',
  'workMode',
  'additionalInfo',
]

function normalizePreviewValue(field, value) {
  if (field === 'skills') {
    return Array.isArray(value) ? value.filter((skill) => typeof skill === 'string' && skill.trim()).join(', ') : ''
  }
  if (field === 'workMode') {
    return ['onsite', 'hybrid', 'remote'].includes(value) ? value : ''
  }
  if (field === 'experienceMin' || field === 'experienceMax') {
    return Number.isInteger(value) && value >= 0 ? String(value) : ''
  }
  return typeof value === 'string' ? value.trim() : ''
}

export function clearAutoFilledJobFields(values, autoFilledFields, manualEdits) {
  const next = { ...values }
  for (const field of autoFilledFields) {
    if (IMPORTABLE_FIELDS.includes(field) && !manualEdits.has(field)) next[field] = ''
  }
  return next
}

export function mergeJobDescriptionPreview(values, fields, manualEdits) {
  const next = { ...values }
  const autoFilledFields = new Set()
  for (const field of IMPORTABLE_FIELDS) {
    if (manualEdits.has(field) || String(next[field] ?? '').trim()) continue
    const value = normalizePreviewValue(field, fields?.[field])
    if (!value) continue
    next[field] = value
    autoFilledFields.add(field)
  }
  return { values: next, autoFilledFields }
}
