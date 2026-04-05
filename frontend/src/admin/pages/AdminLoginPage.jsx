import { useEffect, useMemo, useState } from 'react'

const SESSION_TIMEOUT_SECONDS = 15 * 60

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = String(Math.floor(value / 60)).padStart(2, '0')
  const remainder = String(value % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [acceptedEula, setAcceptedEula] = useState(false)
  const [requiresTwoFactorSetup, setRequiresTwoFactorSetup] = useState(false)
  const [setupToken, setSetupToken] = useState('')
  const [sessionRemaining, setSessionRemaining] = useState(SESSION_TIMEOUT_SECONDS)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const timerLabel = useMemo(() => formatSeconds(sessionRemaining), [sessionRemaining])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSessionRemaining((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setStatus('Signing in…')

    try {
      const response = await fetch('/api/auth/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          totpCode,
          backupCode,
          acceptedEula,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (payload.requiresTwoFactorSetup && payload.setupToken) {
          setRequiresTwoFactorSetup(true)
          setSetupToken(payload.setupToken)
          setStatus('2FA setup required before access.')
          return
        }

        throw new Error(payload.error || 'Unable to login')
      }

      if (payload.requiresTwoFactorSetup && payload.setupToken) {
        setRequiresTwoFactorSetup(true)
        setSetupToken(payload.setupToken)
        setStatus('2FA setup required before access.')
        return
      }

      setSessionRemaining(payload.sessionTimeoutSeconds || SESSION_TIMEOUT_SECONDS)
      setStatus('Admin login successful.')
    } catch (requestError) {
      setStatus('')
      setError(requestError.message)
    }
  }

  async function refreshSession() {
    try {
      const response = await fetch('/api/admin/actions?limit=1', {
        credentials: 'include',
      })

      if (response.ok) {
        setSessionRemaining(SESSION_TIMEOUT_SECONDS)
      }
    } catch {
      setError('Could not refresh admin session')
    }
  }

  return (
    <main style={{ maxWidth: 440, margin: '0 auto', padding: 24 }}>
      <h1>Admin Console Login</h1>
      <p>Separate admin authentication with EULA acceptance + TOTP.</p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" required />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
        <input type="text" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="TOTP code (6 digits)" />
        <input type="text" value={backupCode} onChange={(event) => setBackupCode(event.target.value)} placeholder="Backup code (optional)" />

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={acceptedEula}
            onChange={(event) => setAcceptedEula(event.target.checked)}
          />
          <span>I accept the Admin EULA and acceptable-use policy.</span>
        </label>

        <button type="submit">Sign in as admin</button>
      </form>

      <section style={{ marginTop: 16 }}>
        <strong>Session timeout:</strong> {timerLabel}
        <div>
          <button type="button" onClick={refreshSession} style={{ marginTop: 8 }}>
            Refresh activity timer
          </button>
        </div>
      </section>

      {requiresTwoFactorSetup ? (
        <p style={{ marginTop: 16 }}>
          2FA is not configured. Continue setup here:
          {' '}
          <a href={`/admin/setup-2fa?token=${encodeURIComponent(setupToken)}`}>AdminSetup2FA</a>
        </p>
      ) : null}

      {status ? <p style={{ color: '#0369a1' }}>{status}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
    </main>
  )
}
