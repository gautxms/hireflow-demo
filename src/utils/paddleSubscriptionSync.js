export async function syncCompletedCheckout({
  apiBase,
  token,
  transactionId = null,
  fetchImpl = globalThis.fetch,
}) {
  if (!token || typeof fetchImpl !== 'function') {
    return { synced: false, reason: 'missing_session' }
  }

  const response = await fetchImpl(`${apiBase || ''}/paddle/checkout/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(transactionId ? { transactionId } : {}),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok && response.status !== 409) {
    throw new Error(payload.error || 'Unable to verify the completed checkout')
  }

  return payload
}
