const CONTEXT_LABELS = {
  jd_fit: 'Match',
  profile_only: 'Profile',
  legacy: 'Legacy',
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeDisplayScore(value) {
  const numeric = normalizeNullableNumber(value)
  if (numeric === null || numeric < 0) return null
  const normalized = numeric > 10 ? numeric / 10 : numeric
  return Math.max(0, Math.min(10, normalized)).toFixed(1)
}

function normalizeRawScore(value) {
  const numeric = normalizeNullableNumber(value)
  if (numeric === null || numeric < 0) return null
  return Math.max(0, Math.min(100, numeric))
}

function resolveContext(candidate = {}, fallbackContext = 'legacy') {
  const context = String(candidate?.scoreContext || '').trim()
  if (context === 'jd_fit' || context === 'profile_only' || context === 'legacy') return context
  return fallbackContext
}

export function resolveDirectoryScoreDisplay(candidate = {}) {
  const displayFromMetadata = normalizeDisplayScore(candidate?.scoreDisplay)
  if (displayFromMetadata !== null) {
    const context = resolveContext(candidate)
    return {
      value: displayFromMetadata,
      label: CONTEXT_LABELS[context] || 'Score',
      text: `${displayFromMetadata}/10`,
      isPending: false,
      context,
    }
  }

  const rawScore = normalizeRawScore(candidate?.scoreRaw)
  if (rawScore !== null) {
    const value = (rawScore / 10).toFixed(1)
    const context = resolveContext(candidate)
    return {
      value,
      label: CONTEXT_LABELS[context] || 'Score',
      text: `${value}/10`,
      isPending: false,
      context,
    }
  }

  const profileScore = normalizeRawScore(candidate?.profileScore)
  if (profileScore !== null) {
    const value = (profileScore / 10).toFixed(1)
    return {
      value,
      label: CONTEXT_LABELS.profile_only,
      text: `${value}/10`,
      isPending: false,
      context: 'profile_only',
    }
  }

  return {
    value: null,
    label: 'Pending',
    text: 'Score pending',
    isPending: true,
    context: 'missing',
  }
}
