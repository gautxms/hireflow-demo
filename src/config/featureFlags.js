const FEATURE_KEYS = {
  sidebarShell: 'sidebar_shell',
  analysesPages: 'analyses_pages',
  candidateModule: 'candidate_module',
  dashboardReports: 'dashboard_reports',
  shortlistV2: 'shortlist_v2',
}

const FEATURE_ENV_PREFIX = {
  [FEATURE_KEYS.sidebarShell]: 'SIDEBAR_SHELL',
  [FEATURE_KEYS.analysesPages]: 'ANALYSES_PAGES',
  [FEATURE_KEYS.candidateModule]: 'CANDIDATE_MODULE',
  [FEATURE_KEYS.dashboardReports]: 'DASHBOARD_REPORTS',
  [FEATURE_KEYS.shortlistV2]: 'SHORTLIST_V2',
}

const OVERRIDE_PREFIX = 'hireflow_ff_'

function normalizeList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function parseRolloutValue(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(100, parsed))
}

function hashStringToBucket(value) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }

  return Math.abs(hash >>> 0) % 100
}

function getCohortIdentity(userProfile = null) {
  const email = String(userProfile?.email || '').trim().toLowerCase()
  const userId = String(userProfile?.id || userProfile?.userId || '').trim().toLowerCase()
  return userId || email || ''
}

function resolveFeatureEnv(featureKey, suffix) {
  const keyPrefix = FEATURE_ENV_PREFIX[featureKey]
  if (!keyPrefix) {
    return ''
  }

  return import.meta.env[`VITE_FF_${keyPrefix}_${suffix}`]
}

function readLocalOverride(featureKey) {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(`${OVERRIDE_PREFIX}${featureKey}`)
  if (raw === 'on') {
    return true
  }

  if (raw === 'off') {
    return false
  }

  return null
}

function isExplicitlyEnabled(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase()
  return normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'enabled'
}

function isExplicitlyDisabled(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase()
  return normalized === 'off' || normalized === 'false' || normalized === '0' || normalized === 'disabled'
}

export function isFeatureEnabled(featureKey, { userProfile = null } = {}) {
  const localOverride = readLocalOverride(featureKey)
  if (localOverride !== null) {
    return localOverride
  }

  const baseState = resolveFeatureEnv(featureKey, 'ENABLED')
  if (isExplicitlyEnabled(baseState)) {
    return true
  }

  if (isExplicitlyDisabled(baseState)) {
    return false
  }

  const cohortIdentity = getCohortIdentity(userProfile)
  const allowlist = normalizeList(resolveFeatureEnv(featureKey, 'ALLOWLIST'))
  if (cohortIdentity && allowlist.includes(cohortIdentity)) {
    return true
  }

  const rolloutPercent = parseRolloutValue(resolveFeatureEnv(featureKey, 'ROLLOUT'))
  if (rolloutPercent !== null) {
    if (!cohortIdentity) {
      return false
    }

    return hashStringToBucket(cohortIdentity) < rolloutPercent
  }

  return import.meta.env.PROD ? false : true
}

export { FEATURE_KEYS }
