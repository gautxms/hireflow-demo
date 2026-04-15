import { useCallback, useEffect, useMemo, useState } from 'react'
import TwoFactorForm from '../components/TwoFactorForm'
import AuditTrailTable from '../components/AuditTrailTable'
import useAdminAuth from '../hooks/useAdminAuth'
import API_BASE from '../../config/api'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [auditTrail, setAuditTrail] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    formattedTimer,
    warningVisible,
    status,
    error,
    needsTwoFactor,
    setupToken,
    activeSessions,
    acceptedEula,
    requiresEula,
    setAcceptedEula,
    setError,
    setStatus,
    setWarningVisible,
    loginWithPassword,
    verifySecondFactor,
    refreshActivity,
    loadSessions,
    logoutOtherSessions,
    logout,
  } = useAdminAuth()

  const currentSession = useMemo(() => activeSessions.find((session) => session.isCurrent), [activeSessions])

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

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1>Admin Security Login</h1>
          <p>Email/password + 2FA authentication for admin access.</p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div><strong>Session timer:</strong> {formattedTimer}</div>
          <small>Updates every 10 seconds</small>
        </div>
      </header>

      {warningVisible ? (
        <div style={{ marginTop: 12, padding: 10, border: '1px solid #f59e0b', borderRadius: 8, background: '#fef3c7' }}>
          <strong>Inactivity alert:</strong> you will be logged out after 15 minutes of inactivity.
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => refreshActivity()}>Stay signed in</button>
            <button type="button" onClick={() => setWarningVisible(false)} style={{ marginLeft: 8 }}>Dismiss</button>
          </div>
        </div>
      ) : null}

      <section style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        <form onSubmit={handlePasswordLogin} style={{ display: 'grid', gap: 10 }}>
          <h2>Step 1: Credentials</h2>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" required />
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={acceptedEula} onChange={(event) => setAcceptedEula(event.target.checked)} />
            <span>I accept the Admin EULA and acceptable-use policy.</span>
          </label>
          {requiresEula ? <small style={{ color: '#92400e' }}>EULA acceptance is required before first admin login.</small> : null}
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Continue'}</button>
        </form>

        {needsTwoFactor ? <TwoFactorForm onVerify={handleSecondFactor} isSubmitting={isSubmitting} /> : null}

        <section>
          <h2>Setup 2FA</h2>
          <a href={setupToken ? `/admin/setup-2fa?token=${encodeURIComponent(setupToken)}` : '/admin/setup-2fa'}>Open 2FA setup wizard</a>
        </section>

        <section>
          <h2>Session manager</h2>
          <p>Current session: {currentSession?.device || 'Unknown device'} · {currentSession?.ipAddress || 'Unknown IP'}</p>
          <button type="button" onClick={() => logoutOtherSessions().catch((requestError) => setError(requestError.message))}>Logout other devices</button>
          <button type="button" onClick={() => logout()} style={{ marginLeft: 8 }}>Logout</button>
          <ul>
            {activeSessions.map((session) => (
              <li key={session.id}>
                {session.device || 'Unknown'} · {session.ipAddress || 'Unknown IP'} · {session.location || 'Unknown location'} {session.isCurrent ? '(current)' : ''}
              </li>
            ))}
          </ul>
        </section>
      </section>

      <AuditTrailTable records={auditTrail} />

      {status ? <p style={{ color: '#0369a1' }}>{status}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
    </main>
  )
}
