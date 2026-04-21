import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import API_BASE from '../../config/api'
import useAdminUxTracking from './useAdminUxTracking'
import { ADMIN_SESSION_EXPIRED_EVENT, clearAdminSessionStorage, handleAdminUnauthorized } from '../utils/adminErrorState'
import { shouldVerifyAdminSessionOnVisibility } from '../utils/adminSessionLifecycle'

const DEFAULT_TIMEOUT_SECONDS = 15 * 60
const TIMER_TICK_SECONDS = 10
const ADMIN_SESSION_STORAGE_KEY = 'admin_session'
const DEFAULT_TOTP_PERIOD_SECONDS = 30

const AdminAuthContext = createContext(null)

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

function toHelpfulMessage(message, fallback) {
  const text = String(message || fallback || 'Request failed')

  if (/invalid credentials/i.test(text)) {
    return 'Incorrect email or password. Please try again.'
  }

  if (/invalid 2fa code/i.test(text)) {
    return 'That code is invalid or expired. Try a fresh authenticator code or backup code.'
  }

  return text
}

function useAdminAuthController() {
  const { emitAdminEvent } = useAdminUxTracking()
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(DEFAULT_TIMEOUT_SECONDS)
  const [warningVisible, setWarningVisible] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [pendingPassword, setPendingPassword] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [setupTokenExpiresAt, setSetupTokenExpiresAt] = useState(null)
  const [totpPeriodSeconds, setTotpPeriodSeconds] = useState(DEFAULT_TOTP_PERIOD_SECONDS)
  const [activeSessions, setActiveSessions] = useState([])
  const [acceptedEula, setAcceptedEula] = useState(false)
  const [acceptedEulaForPendingLogin, setAcceptedEulaForPendingLogin] = useState(false)
  const [requiresEula, setRequiresEula] = useState(false)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [authCheckStatus, setAuthCheckStatus] = useState('idle')
  const hasHandledExpiryRef = useRef(false)

  const persistSession = useCallback((payload = {}) => {
    const sessionPayload = {
      adminId: payload?.admin?.id || null,
      email: payload?.admin?.email || null,
      expiresAt: payload?.sessionExpiresAt || null,
      timeoutSeconds: payload?.sessionTimeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
      savedAt: new Date().toISOString(),
    }

    if (sessionPayload.adminId) {
      localStorage.setItem('admin_id', String(sessionPayload.adminId))
    }

    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(sessionPayload))
    setIsAdminAuthenticated(true)
  }, [])

  const clearSession = useCallback(() => {
    clearAdminSessionStorage(localStorage)
    setIsAdminAuthenticated(false)
    setActiveSessions([])
  }, [])

  const formattedTimer = useMemo(() => {
    const value = Math.max(0, Number(sessionSecondsLeft) || 0)
    const minutes = String(Math.floor(value / 60)).padStart(2, '0')
    const seconds = String(value % 60).padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [sessionSecondsLeft])

  const loadSessions = useCallback(async () => {
    const response = await fetch(`${API_BASE}/admin/sessions`, { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      if (response.status === 401) {
        handleAdminUnauthorized()
      }
      throw new Error(extractError(payload, 'Could not load active sessions'))
    }

    const sessions = payload.sessions || []
    setActiveSessions(sessions)
    setIsAdminAuthenticated(sessions.length > 0)
    return sessions
  }, [])

  const verifyAuth = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setAuthCheckStatus('checking')
    }

    try {
      const sessions = await loadSessions()
      const authenticated = sessions.length > 0
      setIsAdminAuthenticated(authenticated)
      setAuthCheckStatus(authenticated ? 'authenticated' : 'unauthenticated')
      return authenticated
    } catch {
      setIsAdminAuthenticated(false)
      setAuthCheckStatus('unauthenticated')
      return false
    }
  }, [loadSessions])

  const loginWithPassword = useCallback(async ({ email, password }) => {
    setError('')
    setStatus('Checking credentials…')
    setRequiresEula(false)

    setAcceptedEulaForPendingLogin(Boolean(acceptedEula))

    const response = await fetch(`${API_BASE}/auth/admin/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, acceptedEula }),
    })
    const payload = await response.json().catch(() => ({}))

    if (payload.requiresTwoFactor) {
      void emitAdminEvent({ eventType: 'admin_2fa_started', route: '/admin/login', metadata: { step: 'verification' } })
      setNeedsTwoFactor(true)
      setPendingEmail(email)
      setPendingPassword(password)
      setStatus('Step 2 of 3: Enter a 2FA code or backup code to finish sign-in.')
      setTotpPeriodSeconds(Number(payload.totpPeriodSeconds) || DEFAULT_TOTP_PERIOD_SECONDS)
      return { requiresTwoFactor: true }
    }

    if (payload.requiresEula) {
      void emitAdminEvent({ eventType: 'admin_auth_dropoff', route: '/admin/login', metadata: { step: 'eula', reason: 'eula_not_accepted' } })
      setRequiresEula(true)
      setStatus('Please accept the admin EULA to continue.')
      return { requiresEula: true }
    }

    if (!response.ok) {
      void emitAdminEvent({ eventType: 'admin_auth_dropoff', route: '/admin/login', metadata: { step: 'credentials', reason: extractError(payload, 'Login failed') } })
      throw new Error(toHelpfulMessage(extractError(payload, 'Login failed'), 'Login failed'))
    }

    if (payload.requiresTwoFactorSetup) {
      void emitAdminEvent({ eventType: 'admin_2fa_started', route: '/admin/login', metadata: { step: 'setup_required' } })
      setSetupToken(payload.setupToken || '')
      setSetupTokenExpiresAt(payload.setupTokenExpiresAt || null)
      setNeedsTwoFactor(false)
      setStatus('Step 2 of 3: Two-factor setup is required before admin access.')
      return { requiresTwoFactor: false, requiresTwoFactorSetup: true, setupToken: payload.setupToken || '' }
    }

    setSessionSecondsLeft(payload.sessionTimeoutSeconds || DEFAULT_TIMEOUT_SECONDS)
    hasHandledExpiryRef.current = false
    setStatus('Signed in.')
    setSetupToken('')
    setSetupTokenExpiresAt(null)
    setRequiresEula(false)
    setPendingEmail('')
    setPendingPassword('')
    persistSession(payload)
    await verifyAuth({ silent: true })
    return { requiresTwoFactor: false }
  }, [acceptedEula, emitAdminEvent, persistSession, verifyAuth])

  const verifySecondFactor = useCallback(async ({ totpCode, backupCode }) => {
    setError('')
    setStatus('Verifying 2FA code…')

    const response = await fetch(`${API_BASE}/auth/admin/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: pendingEmail,
        password: pendingPassword,
        totpCode: sanitizeCode(totpCode),
        backupCode: sanitizeCode(backupCode),
        acceptedEula: acceptedEulaForPendingLogin,
      }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      void emitAdminEvent({ eventType: 'admin_auth_dropoff', route: '/admin/login', metadata: { step: '2fa_verification', reason: extractError(payload, '2FA verification failed') } })
      throw new Error(toHelpfulMessage(extractError(payload, '2FA verification failed'), '2FA verification failed'))
    }

    setNeedsTwoFactor(false)
    setPendingEmail('')
    setPendingPassword('')
    setAcceptedEulaForPendingLogin(false)
    setSessionSecondsLeft(payload.sessionTimeoutSeconds || DEFAULT_TIMEOUT_SECONDS)
    setTotpPeriodSeconds(Number(payload.totpPeriodSeconds) || DEFAULT_TOTP_PERIOD_SECONDS)
    hasHandledExpiryRef.current = false
    setStatus(payload.usedBackupCode ? 'Signed in with one-time backup code.' : '2FA verified. Access granted.')
    void emitAdminEvent({ eventType: 'admin_2fa_completed', route: '/admin/login', metadata: { usedBackupCode: Boolean(payload.usedBackupCode) } })
    persistSession(payload)
    await verifyAuth({ silent: true })
    return payload
  }, [acceptedEulaForPendingLogin, emitAdminEvent, pendingEmail, pendingPassword, persistSession, verifyAuth])

  const refreshActivity = useCallback(async () => {
    const response = await fetch(`${API_BASE}/admin/sessions/refresh`, {
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
    await fetch(`${API_BASE}/auth/admin/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})

    setNeedsTwoFactor(false)
    setPendingEmail('')
    setPendingPassword('')
    setSetupToken('')
    setSetupTokenExpiresAt(null)
    setRequiresEula(false)
    setAcceptedEulaForPendingLogin(false)
    setSessionSecondsLeft(DEFAULT_TIMEOUT_SECONDS)
    hasHandledExpiryRef.current = false
    clearSession()
    setAuthCheckStatus('unauthenticated')
    setStatus(message)
  }, [clearSession])

  const logoutOtherSessions = useCallback(async () => {
    setError('')
    setStatus('Logging out other sessions…')

    const response = await fetch(`${API_BASE}/admin/sessions/logout-others`, {
      method: 'POST',
      credentials: 'include',
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(extractError(payload, 'Could not logout other sessions'))
    }

    await verifyAuth({ silent: true })
    setStatus('Other sessions revoked.')
  }, [verifyAuth])

  useEffect(() => {
    if (!isAdminAuthenticated) {
      return undefined
    }

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
  }, [isAdminAuthenticated, logout])

  useEffect(() => {
    const rawSession = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)

    if (!rawSession) {
      setAuthCheckStatus('unauthenticated')
      return
    }

    try {
      const parsedSession = JSON.parse(rawSession)
      const timeoutSeconds = Number(parsedSession?.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS)
      const expiresAtMs = parsedSession?.expiresAt ? new Date(parsedSession.expiresAt).getTime() : 0
      const secondsLeftFromExpiry = expiresAtMs > 0 ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)) : timeoutSeconds

      if (secondsLeftFromExpiry <= 0) {
        window.setTimeout(() => {
          clearSession()
          setAuthCheckStatus('unauthenticated')
        }, 0)
        return
      }

      window.setTimeout(() => {
        setSessionSecondsLeft(secondsLeftFromExpiry)
        hasHandledExpiryRef.current = false
      }, 0)
    } catch {
      window.setTimeout(() => {
        clearSession()
        setAuthCheckStatus('unauthenticated')
      }, 0)
      return
    }

    void verifyAuth()
  }, [clearSession, verifyAuth])

  useEffect(() => {
    const onSessionExpired = () => {
      clearSession()
      setAuthCheckStatus('unauthenticated')
      setStatus('Session expired. Please sign in again.')
    }

    const onVisibilityChange = () => {
      if (shouldVerifyAdminSessionOnVisibility({ visibilityState: document.visibilityState, pathname: window.location.pathname })) {
        void verifyAuth({ silent: true })
      }
    }

    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, onSessionExpired)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, onSessionExpired)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [clearSession, verifyAuth])

  return {
    sessionSecondsLeft,
    formattedTimer,
    warningVisible,
    status,
    error,
    needsTwoFactor,
    setupToken,
    setupTokenExpiresAt,
    totpPeriodSeconds,
    activeSessions,
    acceptedEula,
    requiresEula,
    isAdminAuthenticated,
    authCheckStatus,
    setAcceptedEula,
    setError,
    setStatus,
    setWarningVisible,
    setSetupToken,
    setSetupTokenExpiresAt,
    loginWithPassword,
    verifySecondFactor,
    refreshActivity,
    loadSessions,
    verifyAuth,
    logoutOtherSessions,
    logout,
  }
}

export function AdminAuthProvider({ children }) {
  const value = useAdminAuthController()
  return createElement(AdminAuthContext.Provider, { value }, children)
}

export default function useAdminAuth() {
  const context = useContext(AdminAuthContext)

  if (!context) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider')
  }

  return context
}
