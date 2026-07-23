const pendingQuotaKeys = new Map()
const QUOTA_KEY_STORAGE_PREFIX = 'hireflow_quota_preflight_v1:'
const PENDING_QUOTA_KEY_TTL_MS = 120 * 60 * 1000

function createQuotaIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `resume-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function hashBatchSignature(value) {
  let hash = 2166136261
  const normalized = String(value || '')
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function quotaStorageKey(batchKey) {
  return `${QUOTA_KEY_STORAGE_PREFIX}${hashBatchSignature(batchKey)}`
}

function readPendingQuotaKey(batchKey) {
  const storageKey = quotaStorageKey(batchKey)
  const inMemory = pendingQuotaKeys.get(storageKey)
  if (inMemory && (Date.now() - inMemory.createdAt) < PENDING_QUOTA_KEY_TTL_MS) {
    return inMemory.key
  }
  if (inMemory) {
    pendingQuotaKeys.delete(storageKey)
  }
  try {
    const stored = globalThis.sessionStorage?.getItem(storageKey)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (
        parsed?.key
        && Number.isFinite(Number(parsed.createdAt))
        && (Date.now() - Number(parsed.createdAt)) < PENDING_QUOTA_KEY_TTL_MS
      ) {
        const retained = { key: String(parsed.key), createdAt: Number(parsed.createdAt) }
        pendingQuotaKeys.set(storageKey, retained)
        return retained.key
      }
      globalThis.sessionStorage?.removeItem(storageKey)
    }
  } catch {
    // In-memory retention still protects retries when session storage is unavailable.
  }
  return null
}

function retainPendingQuotaKey(batchKey, quotaIdempotencyKey) {
  const storageKey = quotaStorageKey(batchKey)
  const retained = { key: quotaIdempotencyKey, createdAt: Date.now() }
  pendingQuotaKeys.set(storageKey, retained)
  try {
    globalThis.sessionStorage?.setItem(storageKey, JSON.stringify(retained))
  } catch {
    // In-memory retention is sufficient for the current page lifecycle.
  }
}

function clearPendingQuotaKey(batchKey) {
  const storageKey = quotaStorageKey(batchKey)
  pendingQuotaKeys.delete(storageKey)
  try {
    globalThis.sessionStorage?.removeItem(storageKey)
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
}

export function buildResumeQuotaBatchKey({ files, context = '' }) {
  const fileSignature = (Array.isArray(files) ? files : []).map((file, index) => [
    index,
    String(file?.name || ''),
    Number(file?.size || 0),
    Number(file?.lastModified || 0),
    String(file?.type || ''),
  ])
  return `resume-quota-${hashBatchSignature(JSON.stringify([String(context || ''), fileSignature]))}`
}

export function buildResumeQuotaFileIdentity(batchKey, fileIndex) {
  return `${String(batchKey || 'resume-quota')}:${Number(fileIndex)}`
}

export async function preflightResumeQuota({ apiBase, token, fileCount, batchKey }) {
  const logicalBatchKey = String(batchKey || createQuotaIdempotencyKey())
  const retainedQuotaKey = readPendingQuotaKey(logicalBatchKey)
  const quotaIdempotencyKey = retainedQuotaKey || createQuotaIdempotencyKey()
  if (!retainedQuotaKey) {
    retainPendingQuotaKey(logicalBatchKey, quotaIdempotencyKey)
  }

  // If fetch rejects, execution stops before clearPendingQuotaKey so a retry
  // can recover a reservation whose response was lost.
  const response = await fetch(`${apiBase}/uploads/chunks/preflight`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Quota-Idempotency-Key': quotaIdempotencyKey,
    },
    body: JSON.stringify({ fileCount, quotaIdempotencyKey }),
  })

  const payload = await response.json().catch(() => ({}))
  clearPendingQuotaKey(logicalBatchKey)
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || 'Unable to reserve resume analysis quota')
    error.status = response.status
    error.quota = payload
    throw error
  }
  return {
    reservationId: payload.reservationId || null,
    quotaIdempotencyKey,
    limit: Number(payload.limit || 0),
    used: Number(payload.used || 0),
    remaining: Number(payload.remaining || 0),
  }
}

export async function releaseResumeQuotaBatch({ apiBase, token, reservationId }) {
  const normalizedReservationId = String(reservationId || '').trim()
  if (!normalizedReservationId) return

  const response = await fetch(`${apiBase}/uploads/chunks/reservations/${normalizedReservationId}/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || 'Unable to release unused resume quota')
  }
}
