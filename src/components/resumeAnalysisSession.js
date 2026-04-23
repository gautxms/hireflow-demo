const RESUME_ANALYSIS_SESSION_KEY = 'hireflow_resume_analysis_session_v1'
const RESUME_ANALYSIS_RESULT_KEY = 'hireflow_resume_analysis_result_v1'

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

function normalizeOwner(ownerKey = '') {
  return String(ownerKey || '').trim().toLowerCase()
}

function resolveReadArgs(ownerKeyOrStorage, maybeStorage) {
  if (ownerKeyOrStorage && typeof ownerKeyOrStorage.getItem === 'function') {
    return {
      ownerKey: '',
      storage: ownerKeyOrStorage,
    }
  }

  return {
    ownerKey: normalizeOwner(ownerKeyOrStorage),
    storage: maybeStorage || localStorage,
  }
}

function resolveWriteArgs(payloadOrOwnerKey, ownerKeyOrStorage, maybeStorage) {
  if (ownerKeyOrStorage && typeof ownerKeyOrStorage.getItem === 'function') {
    return {
      ownerKey: '',
      storage: ownerKeyOrStorage,
      payload: payloadOrOwnerKey,
    }
  }

  return {
    ownerKey: normalizeOwner(ownerKeyOrStorage),
    storage: maybeStorage || localStorage,
    payload: payloadOrOwnerKey,
  }
}

export function getResumeAnalysisOwnerKey(user = null) {
  if (typeof user === 'string') {
    return normalizeOwner(user)
  }

  if (!user || typeof user !== 'object') {
    return ''
  }

  const userId = String(user.id || '').trim()
  if (userId) {
    return normalizeOwner(`user:${userId}`)
  }

  const userEmail = String(user.email || '').trim().toLowerCase()
  if (userEmail) {
    return normalizeOwner(`email:${userEmail}`)
  }

  return ''
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

export function readResumeAnalysisResult(ownerKeyOrStorage = '', maybeStorage = localStorage) {
  const { ownerKey, storage } = resolveReadArgs(ownerKeyOrStorage, maybeStorage)
  const raw = storage.getItem(RESUME_ANALYSIS_RESULT_KEY)
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

  const savedOwnerKey = normalizeOwner(parsed.ownerKey)
  if (savedOwnerKey && ownerKey && savedOwnerKey !== ownerKey) {
    return null
  }

  if (ownerKey && !savedOwnerKey) {
    return null
  }

  return {
    version: 1,
    candidates,
    parseMeta: parsed.parseMeta && typeof parsed.parseMeta === 'object' ? parsed.parseMeta : null,
    jobId: String(parsed.jobId || '').trim(),
    ownerKey: savedOwnerKey,
    savedAt: String(parsed.savedAt || ''),
  }
}

export function writeResumeAnalysisResult(payloadOrOwnerKey, ownerKeyOrStorage = '', maybeStorage = localStorage) {
  const { payload, ownerKey, storage } = resolveWriteArgs(payloadOrOwnerKey, ownerKeyOrStorage, maybeStorage)
  const next = {
    version: 1,
    ...(payload || {}),
    ownerKey,
    savedAt: nowIso(),
  }

  storage.setItem(RESUME_ANALYSIS_RESULT_KEY, JSON.stringify(next))
  return next
}

export function clearResumeAnalysisResult(ownerKeyOrStorage = '', maybeStorage = localStorage) {
  const { ownerKey, storage } = resolveReadArgs(ownerKeyOrStorage, maybeStorage)
  if (!ownerKey) {
    storage.removeItem(RESUME_ANALYSIS_RESULT_KEY)
    return
  }

  const current = readResumeAnalysisResult('', storage)
  if (!current || normalizeOwner(current.ownerKey) !== ownerKey) {
    return
  }

  storage.removeItem(RESUME_ANALYSIS_RESULT_KEY)
}

export function isSessionRecoverable(session) {
  if (!session || typeof session !== 'object') {
    return false
  }

  const terminalStates = new Set(['complete', 'failed', 'cancelled'])
  return Boolean(session.jobId) && !terminalStates.has(String(session.parseStatus || '').toLowerCase())
}

export { RESUME_ANALYSIS_SESSION_KEY, RESUME_ANALYSIS_RESULT_KEY }
