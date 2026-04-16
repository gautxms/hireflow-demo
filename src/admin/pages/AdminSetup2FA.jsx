import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import useAdminUxTracking from '../hooks/useAdminUxTracking'

function readToken() {
  const url = new URL(window.location.href)
  return url.searchParams.get('token') || ''
}

function downloadBackupCodes(codes) {
  const text = ['Admin backup codes (one-time use):', '', ...codes].join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'admin-backup-codes.txt'
  link.click()
  URL.revokeObjectURL(link.href)
}

function decodeSetupTokenExpiry(setupToken) {
  try {
    const parts = String(setupToken || '').split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.admin_setup_expires_at || null
  } catch {
    return null
  }
}

function secondsUntilNextTotpWindow(periodSeconds = 30, nowMs = Date.now()) {
  const nowInSeconds = Math.floor(nowMs / 1000)
  return periodSeconds - (nowInSeconds % periodSeconds)
}

function formatSeconds(seconds) {
  const safeValue = Math.max(0, Number(seconds) || 0)
  const minutes = String(Math.floor(safeValue / 60)).padStart(2, '0')
  const remainder = String(safeValue % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function parseOtpauthDetails(otpauthUrl) {
  if (!otpauthUrl) return null
  try {
    const parsed = new URL(otpauthUrl)
    if (parsed.protocol !== 'otpauth:') return null
    const rawLabel = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    const [issuerFromLabel, accountName] = rawLabel.includes(':') ? rawLabel.split(':') : ['', rawLabel]
    const issuer = parsed.searchParams.get('issuer') || issuerFromLabel || 'HireFlow Admin'
    return {
      issuer,
      accountName: accountName || 'Admin account',
    }
  } catch {
    return null
  }
}

function isLikelyQrImage(value) {
  return /^data:image\//.test(String(value || '')) || /^https?:\/\//.test(String(value || ''))
}

export default function AdminSetup2FA() {
  const { emitAdminEvent } = useAdminUxTracking()
  const [setupToken, setSetupToken] = useState(readToken())
  const [totpCode, setTotpCode] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [manualEntryKey, setManualEntryKey] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [setupTokenExpiresAt, setSetupTokenExpiresAt] = useState(decodeSetupTokenExpiry(readToken()))
  const [totpPeriodSeconds, setTotpPeriodSeconds] = useState(30)
  const [clockTick, setClockTick] = useState(() => Date.now())
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [qrLoadState, setQrLoadState] = useState('idle')

  const canVerify = useMemo(() => setupToken.trim().length > 0 && totpCode.trim().length >= 6, [setupToken, totpCode])

  async function beginSetup() {
    setError('')
    setStatus('Generating QR code and backup codes…')

    const response = await fetch(`${API_BASE}/auth/admin/2fa/setup`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      setStatus('')
      void emitAdminEvent({ eventType: 'admin_page_load_failed', route: '/admin/setup-2fa', metadata: { reason: payload.error || 'setup_init_failed' } })
      setError(payload.error || 'Unable to initialize 2FA setup')
      return
    }

    const incomingCodes = Array.isArray(payload.backupCodes) ? payload.backupCodes.slice(0, 10) : []
    const nextQrCode = payload.qrCodeDataUrl || ''
    setQrCodeDataUrl(nextQrCode)
    setQrLoadState(nextQrCode && isLikelyQrImage(nextQrCode) ? 'loading' : 'error')
    setOtpauthUrl(payload.otpauthUrl || '')
    setManualEntryKey(payload.manualEntryKey || '')
    setBackupCodes(incomingCodes)
    setSetupTokenExpiresAt(payload.setupTokenExpiresAt || decodeSetupTokenExpiry(setupToken))
    setTotpPeriodSeconds(Number(payload.totpPeriodSeconds) || 30)
    setStatus('Scan the QR code, store your backup codes safely, then verify.')
  }

  async function verifyCode(event) {
    event.preventDefault()
    setError('')
    setStatus('Verifying authenticator code…')

    const response = await fetch(`${API_BASE}/auth/admin/2fa/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, totpCode }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      setStatus('')
      void emitAdminEvent({ eventType: 'admin_auth_dropoff', route: '/admin/setup-2fa', metadata: { step: '2fa_setup_verify', reason: payload.error || 'verification_failed' } })
      const rawMessage = String(payload.error || '').toLowerCase()
      if (rawMessage.includes('invalid totp code')) {
        setError('That code didn’t work. Wait for the next 6-digit code, then try again. If this keeps happening, check that your phone time is set to automatic.')
      } else {
        setError(payload.error || 'Verification failed')
      }
      return
    }

    setTotpPeriodSeconds(Number(payload.totpPeriodSeconds) || 30)
    setStatus('2FA is enabled. Continue to admin login.')
    void emitAdminEvent({ eventType: 'admin_2fa_completed', route: '/admin/setup-2fa', metadata: { source: 'setup_wizard' } })
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const setupTokenSecondsLeft = useMemo(() => {
    if (!setupTokenExpiresAt) return 0
    return Math.max(0, Math.floor((new Date(setupTokenExpiresAt).getTime() - clockTick) / 1000))
  }, [clockTick, setupTokenExpiresAt])

  const totpWindowSecondsLeft = useMemo(
    () => secondsUntilNextTotpWindow(totpPeriodSeconds, clockTick),
    [clockTick, totpPeriodSeconds],
  )

  const setupProgress = useMemo(() => {
    if (backupCodes.length === 0) return 'Progress: 1/3 (initialize setup)'
    if (backupCodes.length > 0 && status.toLowerCase().includes('enabled')) return 'Progress: 3/3 (done)'
    return 'Progress: 2/3 (verify authenticator)'
  }, [backupCodes.length, status])

  const otpDetails = useMemo(() => parseOtpauthDetails(otpauthUrl), [otpauthUrl])

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>Admin 2FA Setup Wizard</h1>
      <p>{setupProgress}</p>
      <p>What to do next: use your setup token, generate backup codes, verify a TOTP code, then return to admin login.</p>

      <div style={{ display: 'grid', gap: 10 }}>
        <label htmlFor="setupToken">Setup token</label>
        <input id="setupToken" value={setupToken} onChange={(event) => {
          const incomingToken = event.target.value
          setSetupToken(incomingToken)
          setSetupTokenExpiresAt(decodeSetupTokenExpiry(incomingToken))
        }} />
        <small style={{ color: setupTokenSecondsLeft > 0 ? '#334155' : '#b91c1c' }}>
          Setup token expires in {formatSeconds(setupTokenSecondsLeft)}.
        </small>
        <button type="button" onClick={beginSetup}>Generate QR + backup codes</button>
        <a href="/admin/login">Regenerate setup token from login</a>
      </div>

      {qrCodeDataUrl ? (
        <section style={{ marginTop: 16 }}>
          <h2>Scan in authenticator app</h2>
          {qrLoadState === 'error' ? (
            <p style={{ color: '#92400e', marginBottom: 8 }}>
              We couldn’t display a scannable QR image right now. Use the manual setup key below or refresh and try again.
            </p>
          ) : null}
          <img
            src={qrCodeDataUrl}
            alt="Admin TOTP QR code"
            style={{ width: 220, height: 220, border: '1px solid #cbd5e1', borderRadius: 8, padding: 4, background: '#fff' }}
            onLoad={() => setQrLoadState('ready')}
            onError={() => setQrLoadState('error')}
          />
          {otpDetails ? (
            <p style={{ marginTop: 8 }}>
              <strong>Issuer:</strong> {otpDetails.issuer}<br />
              <strong>Account:</strong> {otpDetails.accountName}
            </p>
          ) : null}
          {manualEntryKey ? (
            <>
              <p>
                <strong>Manual setup key:</strong>{' '}
                <code style={{ userSelect: 'all' }}>{manualEntryKey}</code>
              </p>
              <button type="button" onClick={() => navigator.clipboard.writeText(manualEntryKey).catch(() => {})}>Copy setup key</button>
            </>
          ) : null}
          {otpauthUrl ? (
            <p>
              <a href={otpauthUrl}>Open authenticator link</a>
            </p>
          ) : null}
        </section>
      ) : null}

      {backupCodes.length > 0 ? (
        <section style={{ marginTop: 16 }}>
          <h2>Backup codes (10 total, one-time use)</h2>
          <p><strong>Print these down</strong> and keep them offline.</p>
          <ul>
            {backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}
          </ul>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => downloadBackupCodes(backupCodes)}>Download backup codes</button>
            <button type="button" onClick={() => window.print()}>Print backup codes</button>
          </div>
        </section>
      ) : null}

      <form onSubmit={verifyCode} style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        <label htmlFor="totpCode">Verification code</label>
        <small style={{ color: '#334155' }}>Current code window expires in {totpWindowSecondsLeft}s.</small>
        <input
          id="totpCode"
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <small style={{ color: '#475569' }}>
          If a code fails, wait for the timer to reset and enter the next one. Make sure your phone time is set automatically.
        </small>
        <button type="submit" disabled={!canVerify}>Verify and enable 2FA</button>
        <small style={{ color: '#475569' }}>
          Lost access to your authenticator? Go back to <a href="/admin/login">admin login</a> and complete sign-in with a backup code.
        </small>
      </form>

      {status ? <p style={{ color: '#0369a1' }}>{status}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
    </main>
  )
}
