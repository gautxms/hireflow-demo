import { useEffect, useMemo, useState } from 'react'

const AUTH_TOKEN_KEY = 'hireflow_auth_token'

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null

  const [, payload] = token.split('.')
  if (!payload) return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}

export default function useAdminAuth({ redirectTo = '/login' } = {}) {
  const [token, setToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY) || '')

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === AUTH_TOKEN_KEY) {
        setToken(event.newValue || '')
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const payload = useMemo(() => decodeJwtPayload(token), [token])
  const expiresAt = Number(payload?.exp || 0)
  const isAdmin = Boolean(payload?.is_admin)
  const isAuthenticated = Boolean(token && payload)

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      window.location.replace(redirectTo)
    }
  }, [isAdmin, isAuthenticated, redirectTo])

  return {
    isAdmin,
    isAuthenticated,
    token,
    payload,
    expiresAt,
  }
}
