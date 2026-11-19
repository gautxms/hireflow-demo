const GOOGLE_AUTH_PATH = '/api/auth/google'

export async function submitGoogleAuth(path, body, fetchImpl = fetch) {
  const csrfResponse = await fetchImpl(`${GOOGLE_AUTH_PATH}/csrf`, { credentials: 'include' })
  const csrfPayload = await csrfResponse.json().catch(() => null)
  if (!csrfResponse.ok || !csrfPayload?.csrfToken) {
    throw new Error(csrfPayload?.error || 'Google sign-in is unavailable. Try email and password.')
  }

  const response = await fetchImpl(`${GOOGLE_AUTH_PATH}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-HireFlow-Google-CSRF': csrfPayload.csrfToken,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Google sign-in failed (${response.status})`)
  }
  return payload
}

export function isGoogleAuthConfigured(env = import.meta.env) {
  return env.VITE_GOOGLE_AUTH_ENABLED === 'true' && Boolean(env.VITE_GOOGLE_CLIENT_ID?.trim())
}
