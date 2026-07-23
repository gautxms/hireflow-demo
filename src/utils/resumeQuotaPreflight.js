function createQuotaIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `resume-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function preflightResumeQuota({ apiBase, token, fileCount }) {
  const quotaIdempotencyKey = createQuotaIdempotencyKey()
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
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || 'Unable to reserve resume analysis quota')
    error.status = response.status
    error.quota = payload
    throw error
  }
  return {
    reservationId: payload.reservationId || null,
    limit: Number(payload.limit || 0),
    used: Number(payload.used || 0),
    remaining: Number(payload.remaining || 0),
  }
}
