const RESUME_ANALYSIS_SESSION_KEY = 'hireflow_resume_analysis_session_v1'
const RESUME_ANALYSIS_RESULT_KEY = 'hireflow_resume_analysis_result_v1'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function nowIso() {
  return new Date().toISOString()
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function readScopeValue(storage = localStorage) {
  const rawUserProfile = storage.getItem(USER_STORAGE_KEY)
  const parsedUserProfile = safeJsonParse(rawUserProfile, null)
  const userId = String(parsedUserProfile?.id || '').trim()
  if (userId) {
    return `user:${userId}`
  }

  const userEmail = String(parsedUserProfile?.email || '').trim().toLowerCase()
  if (userEmail) {
    return `email:${userEmail}`
  }

  const token = String(storage.getItem(TOKEN_STORAGE_KEY) || '').trim()
  if (token) {
    return `token:${token}`
  }

  return ''
}

function getScopedResumeAnalysisResultKey(storage = localStorage) {
  const scopeValue = readScopeValue(storage)
  if (!scopeValue) {
    return ''
  }
  return `${RESUME_ANALYSIS_RESULT_KEY}::${scopeValue}`
}

export function buildFileFingerprintFromMetadata(file) {
  if (!file || typeof file !== 'object') {
    return ''
  }

  const name = String(file.name || '').trim()
  const size = Number(file.size || 0)
  const lastModified = Number(file.lastModified || 0)
  if (!name || !Number.isFinite(size) || !Number.isFinite(lastModified)) {
    return ''
  }

  return `${name}::${size}::${lastModified}`
}

export function buildFileSnapshot(uploadedFiles) {
  const items = Array.isArray(uploadedFiles) ? uploadedFiles : []
  return items
    .map((entry) => {
      const file = entry?.file
      const name = String(entry?.name || file?.name || '').trim()
      const size = Number(entry?.size || file?.size || 0)
      const lastModified = Number(file?.lastModified || 0)
      const fingerprint = buildFileFingerprintFromMetadata({ name, size, lastModified })

      if (!name || !Number.isFinite(size) || !fingerprint) {
        return null
      }

      return { name, size, lastModified, fingerprint }
    })
    .filter(Boolean)
}

export function readResumeAnalysisSession(storage = localStorage) {
  const raw = storage.getItem(RESUME_ANALYSIS_SESSION_KEY)
  if (!raw) {
    return null
  }

  const parsed = safeJsonParse(raw, null)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const jobId = String(parsed.jobId || '').trim()
  if (!jobId) {
    return null
  }

  return {
    version: 1,
    jobId,
    selectedJobDescriptionId: String(parsed.selectedJobDescriptionId || '').trim(),
    parseStatus: String(parsed.parseStatus || 'processing').trim() || 'processing',
    parseProgress: Number(parsed.parseProgress || 0),
    fileSnapshots: Array.isArray(parsed.fileSnapshots) ? parsed.fileSnapshots : [],
    updatedAt: String(parsed.updatedAt || ''),
  }
}

export function writeResumeAnalysisSession(payload, storage = localStorage) {
  const previous = readResumeAnalysisSession(storage)
  const next = {
    version: 1,
    ...(previous || {}),
    ...(payload || {}),
    updatedAt: nowIso(),
  }

  storage.setItem(RESUME_ANALYSIS_SESSION_KEY, JSON.stringify(next))
  return next
}

export function clearResumeAnalysisSession(storage = localStorage) {
  storage.removeItem(RESUME_ANALYSIS_SESSION_KEY)
}

export function readResumeAnalysisResult(storage = localStorage) {
  const scopedKey = getScopedResumeAnalysisResultKey(storage)
  if (!scopedKey) {
    return null
  }

  const raw = storage.getItem(scopedKey)
  if (!raw) {
    return null
  }

  const parsed = safeJsonParse(raw, null)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : []
  if (candidates.length === 0) {
    return null
  }

  return {
    version: 1,
    candidates,
    parseMeta: parsed.parseMeta && typeof parsed.parseMeta === 'object' ? parsed.parseMeta : null,
    jobId: String(parsed.jobId || '').trim(),
    savedAt: String(parsed.savedAt || ''),
  }
}

export function writeResumeAnalysisResult(payload, storage = localStorage) {
  const scopedKey = getScopedResumeAnalysisResultKey(storage)
  if (!scopedKey) {
    return null
  }

  const next = {
    version: 1,
    ...(payload || {}),
    savedAt: nowIso(),
  }

  storage.setItem(scopedKey, JSON.stringify(next))
  return next
}

export function clearResumeAnalysisResult(storage = localStorage) {
  const scopedKey = getScopedResumeAnalysisResultKey(storage)
  if (!scopedKey) {
    return
  }
  storage.removeItem(scopedKey)
}

export function isSessionRecoverable(session) {
  if (!session || typeof session !== 'object') {
    return false
  }

  const terminalStates = new Set(['complete', 'failed', 'cancelled'])
  return Boolean(session.jobId) && !terminalStates.has(String(session.parseStatus || '').toLowerCase())
}

export { RESUME_ANALYSIS_SESSION_KEY, RESUME_ANALYSIS_RESULT_KEY }
