import { useCallback, useEffect, useMemo, useState } from 'react'
import TwoFactorForm from '../components/TwoFactorForm'
import AuditTrailTable from '../components/AuditTrailTable'
import useAdminAuth from '../hooks/useAdminAuth'
import API_BASE from '../../config/api'
import { Alert, Card, FormRow, SectionHeader } from '../components/primitives/AdminPrimitives'

function formatSeconds(seconds) {
  const safeValue = Math.max(0, Number(seconds) || 0)
  const minutes = String(Math.floor(safeValue / 60)).padStart(2, '0')
  const remainder = String(safeValue % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [auditTrail, setAuditTrail] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [setupTokenSecondsLeft, setSetupTokenSecondsLeft] = useState(0)

  const {
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
    logoutOtherSessions,
    logout,
  } = useAdminAuth()

  const currentSession = useMemo(() => activeSessions.find((session) => session.isCurrent), [activeSessions])
  const loginProgress = useMemo(() => {
    if (needsTwoFactor) return 'Progress: 2/3 (2FA verification)'
    if (setupToken) return 'Progress: 2/3 (2FA setup)'
    return 'Progress: 1/3 (credentials + EULA)'
  }, [needsTwoFactor, setupToken])

  const loadAuditTrail = useCallback(async () => {
    const response = await fetch(`${API_BASE}/admin/actions?limit=200`, { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(payload.error || 'Could not load audit trail')
    }

    setAuditTrail(payload.actions || [])
  }, [])

  const handlePasswordLogin = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const result = await loginWithPassword({ email, password })

      if (!result.requiresTwoFactor && !result.requiresTwoFactorSetup) {
        await Promise.all([loadSessions(), loadAuditTrail().catch(() => {})])
        window.location.assign('/admin/analytics')
      }
    } catch (requestError) {
      setStatus('')
      setError(requestError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSecondFactor = async ({ totpCode, backupCode }) => {
    setIsSubmitting(true)

    try {
      await verifySecondFactor({ totpCode, backupCode })
      await Promise.all([loadSessions(), loadAuditTrail().catch(() => {})])
      window.location.assign('/admin/analytics')
    } catch (requestError) {
      setStatus('')
      setError(requestError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    loadSessions().catch(() => {})
    loadAuditTrail().catch(() => {})
  }, [loadAuditTrail, loadSessions])

  useEffect(() => {
    if (!setupTokenExpiresAt) {
      setSetupTokenSecondsLeft(0)
      return undefined
    }

    const update = () => {
      const seconds = Math.max(0, Math.floor((new Date(setupTokenExpiresAt).getTime() - Date.now()) / 1000))
      setSetupTokenSecondsLeft(seconds)
    }

    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [setupTokenExpiresAt])

  const regenerateSetupToken = async () => {
    if (!email || !password) {
      setError('Enter email and password first, then regenerate a setup token.')
      return
    }

    setIsSubmitting(true)
    setError('')
    setStatus('Regenerating setup token…')
    try {
      const result = await loginWithPassword({ email, password })
      if (!result.requiresTwoFactorSetup) {
        setStatus('This account already has 2FA enabled. Continue to 2FA verification.')
      }
    } catch (requestError) {
      setStatus('')
      setError(requestError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-flow__header">
        <SectionHeader title="Admin Security Login" eyebrow={loginProgress} />
        <div className="admin-flow__status">
          <div><strong>Session timer:</strong> {formattedTimer}</div>
          <small>Updates every 10 seconds</small>
        </div>
      </header>

      {warningVisible ? (
        <Alert tone="warning">
          <strong>Session timeout warning:</strong> you will be logged out after 15 minutes of inactivity.
          <p className="mt-1">What to do next: click “Stay signed in” to refresh the timer, or finish your current auth step immediately.</p>
          <div className="admin-flow__actions mt-2">
            <button type="button" className="ui-btn" onClick={() => refreshActivity()}>Stay signed in</button>
            <button type="button" className="ui-btn" onClick={() => setWarningVisible(false)}>Dismiss</button>
          </div>
        </Alert>
      ) : null}

      <section className="admin-flow">
        <Card as="form" onSubmit={handlePasswordLogin} className="admin-flow">
          <SectionHeader title="Step 1: Credentials" subtitle="Enter admin credentials, accept the EULA, and continue." />
          <FormRow label="Email" htmlFor="admin-email">
            <input className="ui-input" id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" required />
          </FormRow>
          <FormRow label="Password" htmlFor="admin-password">
            <input className="ui-input" id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
          </FormRow>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={acceptedEula} onChange={(event) => setAcceptedEula(event.target.checked)} />
            <span>I accept the Admin EULA and acceptable-use policy.</span>
          </label>
          {requiresEula ? <Alert tone="warning">EULA acceptance is required before first admin login.</Alert> : null}
          <button type="submit" className="ui-btn ui-btn--primary" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Continue'}</button>
        </Card>

        {needsTwoFactor ? <TwoFactorForm onVerify={handleSecondFactor} isSubmitting={isSubmitting} totpPeriodSeconds={totpPeriodSeconds} /> : null}

        <Card className="admin-flow">
          <SectionHeader title="2FA setup recovery" subtitle="Open setup, generate backup codes, verify a TOTP code, then return here to sign in." />
          {setupToken ? (
            <p className="admin-note">Setup token expires in <strong>{formatSeconds(setupTokenSecondsLeft)}</strong>.</p>
          ) : (
            <p className="admin-note">No setup token yet. Use Step 1 first to generate a setup token.</p>
          )}
          <div className="admin-flow__actions">
            <a className="ui-btn" href={setupToken ? `/admin/setup-2fa?token=${encodeURIComponent(setupToken)}` : '/admin/setup-2fa'}>Open 2FA setup wizard</a>
            <button type="button" className="ui-btn" onClick={regenerateSetupToken} disabled={isSubmitting}>Regenerate setup token</button>
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                setSetupToken('')
                setSetupTokenExpiresAt(null)
              }}
            >
              Clear setup token
            </button>
          </div>
        </Card>

        <Card className="admin-flow">
          <SectionHeader title="Session manager" />
          <p className="admin-note">Current session: {currentSession?.device || 'Unknown device'} · {currentSession?.ipAddress || 'Unknown IP'}</p>
          <div className="admin-flow__actions">
            <button type="button" className="ui-btn" onClick={() => logoutOtherSessions().catch((requestError) => setError(requestError.message))}>Logout other devices</button>
            <button type="button" className="ui-btn" onClick={() => logout()}>Logout</button>
          </div>
          <ul className="admin-code-list">
            {activeSessions.map((session) => (
              <li key={session.id}>
                {session.device || 'Unknown'} · {session.ipAddress || 'Unknown IP'} · {session.location || 'Unknown location'} {session.isCurrent ? '(current)' : ''}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <AuditTrailTable records={auditTrail} />

      {status ? <Alert tone="info">{status}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </main>
  )
}
