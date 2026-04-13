import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_TIMEOUT_SECONDS = 15 * 60
const TIMER_TICK_SECONDS = 10

function sanitizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
}

function extractError(payload, fallback) {
  if (!payload) {
    return fallback
  }

  return payload.error || payload.message || fallback
}

export default function useAdminAuth() {
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(DEFAULT_TIMEOUT_SECONDS)
  const [warningVisible, setWarningVisible] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false)
  const [authChallengeId, setAuthChallengeId] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [pendingPassword, setPendingPassword] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [activeSessions, setActiveSessions] = useState([])
  const hasHandledExpiryRef = useRef(false)

  const formattedTimer = useMemo(() => {
    const value = Math.max(0, Number(sessionSecondsLeft) || 0)
    const minutes = String(Math.floor(value / 60)).padStart(2, '0')
    const seconds = String(value % 60).padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [sessionSecondsLeft])

  const loadSessions = useCallback(async () => {
    const response = await fetch('/api/admin/sessions', { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(extractError(payload, 'Could not load active sessions'))
    }

    setActiveSessions(payload.sessions || [])
  }, [])

  const loginWithPassword = useCallback(async ({ email, password }) => {
    setError('')
    setStatus('Checking credentials…')

    const response = await fetch('/api/auth/admin/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(extractError(payload, 'Login failed'))
    }

    if (payload.requiresTwoFactorSetup) {
      setSetupToken(payload.setupToken || '')
      setNeedsTwoFactor(false)
      setStatus('Two-factor setup is required before admin login.')
      return { requiresTwoFactor: false, requiresTwoFactorSetup: true, setupToken: payload.setupToken || '' }
    }

    setNeedsTwoFactor(Boolean(payload.requiresTwoFactor))
    setAuthChallengeId(payload.authChallengeId || '')
    setPendingEmail(email)
    setPendingPassword(password)

    if (payload.requiresTwoFactor) {
      setStatus('Enter your authenticator or backup code to continue.')
      return { requiresTwoFactor: true }
    }

    setSessionSecondsLeft(payload.sessionTimeoutSeconds || DEFAULT_TIMEOUT_SECONDS)
    hasHandledExpiryRef.current = false
    setStatus('Signed in.')
    setSetupToken('')
    setPendingEmail('')
    setPendingPassword('')
    await loadSessions().catch(() => {})
    return { requiresTwoFactor: false }
  }, [loadSessions])

  const verifySecondFactor = useCallback(async ({ totpCode, backupCode }) => {
    setError('')
    setStatus('Verifying 2FA code…')

    const response = await fetch('/api/auth/admin/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: pendingEmail,
        password: pendingPassword,
        totpCode: sanitizeCode(totpCode),
        backupCode: sanitizeCode(backupCode),
      }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(extractError(payload, '2FA verification failed'))
    }

    setNeedsTwoFactor(false)
    setAuthChallengeId('')
    setPendingEmail('')
    setPendingPassword('')
    setSessionSecondsLeft(payload.sessionTimeoutSeconds || DEFAULT_TIMEOUT_SECONDS)
    hasHandledExpiryRef.current = false
    setStatus(payload.usedBackupCode ? 'Signed in with one-time backup code.' : '2FA verified. Access granted.')
    await loadSessions().catch(() => {})
    return payload
  }, [loadSessions, pendingEmail, pendingPassword])

  const refreshActivity = useCallback(async () => {
    const response = await fetch('/api/admin/sessions/refresh', {
      method: 'POST',
      credentials: 'include',
    })

    if (response.ok) {
      setSessionSecondsLeft(DEFAULT_TIMEOUT_SECONDS)
      hasHandledExpiryRef.current = false
      setWarningVisible(false)
    }
  }, [])

  const logout = useCallback(async (message = 'Signed out.') => {
    await fetch('/api/auth/admin/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})

    setNeedsTwoFactor(false)
    setAuthChallengeId('')
    setPendingEmail('')
    setPendingPassword('')
    setSetupToken('')
    setActiveSessions([])
    setSessionSecondsLeft(DEFAULT_TIMEOUT_SECONDS)
    hasHandledExpiryRef.current = false
    setStatus(message)
  }, [])

  const logoutOtherSessions = useCallback(async () => {
    setError('')
    setStatus('Logging out other sessions…')

    const response = await fetch('/api/admin/sessions/logout-others', {
      method: 'POST',
      credentials: 'include',
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(extractError(payload, 'Could not logout other sessions'))
    }

    await loadSessions().catch(() => {})
    setStatus('Other sessions revoked.')
  }, [loadSessions])

  useEffect(() => {
    const tick = window.setInterval(() => {
      setSessionSecondsLeft((prev) => {
        const next = Math.max(0, prev - TIMER_TICK_SECONDS)

        if (next <= 60 && next > 0) {
          setWarningVisible(true)
        }

        if (next === 0 && !hasHandledExpiryRef.current) {
          hasHandledExpiryRef.current = true
          window.setTimeout(() => {
            logout('Session expired after 15 minutes of inactivity.').catch(() => {})
          }, 0)
        }

        return next
      })
    }, TIMER_TICK_SECONDS * 1000)

    return () => window.clearInterval(tick)
  }, [logout])

  return {
    sessionSecondsLeft,
    formattedTimer,
    warningVisible,
    status,
    error,
    needsTwoFactor,
    setupToken,
    activeSessions,
    setError,
    setStatus,
    setWarningVisible,
    loginWithPassword,
    verifySecondFactor,
    refreshActivity,
    loadSessions,
    logoutOtherSessions,
    logout,
  }
}
