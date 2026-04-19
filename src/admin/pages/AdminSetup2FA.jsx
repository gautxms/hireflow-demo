import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import useAdminUxTracking from '../hooks/useAdminUxTracking'
import { Alert, Card, FormRow, SectionHeader } from '../components/primitives/AdminPrimitives'

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
    <main className="admin-page">
      <SectionHeader
        title="Admin 2FA Setup Wizard"
        subtitle="Use your setup token, generate backup codes, verify a TOTP code, then return to admin login."
        eyebrow={setupProgress}
      />

      <Card className="admin-flow">
        <FormRow
          label="Setup token"
          htmlFor="setupToken"
          hint={`Setup token expires in ${formatSeconds(setupTokenSecondsLeft)}.`}
        >
          <input
            className="ui-input"
            id="setupToken"
            value={setupToken}
            onChange={(event) => {
              const incomingToken = event.target.value
              setSetupToken(incomingToken)
              setSetupTokenExpiresAt(decodeSetupTokenExpiry(incomingToken))
            }}
          />
        </FormRow>

        <div className="admin-flow__actions">
          <button type="button" className="ui-btn ui-btn--primary" onClick={beginSetup}>Generate QR + backup codes</button>
          <a className="ui-btn" href="/admin/login">Regenerate setup token from login</a>
        </div>
      </Card>

      {qrCodeDataUrl ? (
        <Card className="admin-flow">
          <SectionHeader title="Scan in authenticator app" />
          {qrLoadState === 'error' ? (
            <Alert tone="warning">
              We couldn’t display a scannable QR image right now. Use the manual setup key below or refresh and try again.
            </Alert>
          ) : null}
          <img
            src={qrCodeDataUrl}
            alt="Admin TOTP QR code"
            className="admin-qr"
            onLoad={() => setQrLoadState('ready')}
            onError={() => setQrLoadState('error')}
          />
          {otpDetails ? <p className="admin-note"><strong>Issuer:</strong> {otpDetails.issuer} · <strong>Account:</strong> {otpDetails.accountName}</p> : null}

          {manualEntryKey ? (
            <div className="admin-flow">
              <p><strong>Manual setup key:</strong> <code>{manualEntryKey}</code></p>
              <button type="button" className="ui-btn" onClick={() => navigator.clipboard.writeText(manualEntryKey).catch(() => {})}>Copy setup key</button>
            </div>
          ) : null}

          {otpauthUrl ? <a href={otpauthUrl}>Open authenticator link</a> : null}
        </Card>
      ) : null}

      {backupCodes.length > 0 ? (
        <Card className="admin-flow">
          <SectionHeader title="Backup codes" subtitle="10 total, one-time use. Save these offline before continuing." />
          <ul className="admin-code-list">
            {backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}
          </ul>
          <div className="admin-flow__actions">
            <button type="button" className="ui-btn" onClick={() => downloadBackupCodes(backupCodes)}>Download backup codes</button>
            <button type="button" className="ui-btn" onClick={() => window.print()}>Print backup codes</button>
          </div>
        </Card>
      ) : null}

      <Card as="form" onSubmit={verifyCode} className="admin-flow">
        <SectionHeader title="Verify authenticator code" />
        <FormRow label="Verification code" htmlFor="totpCode" hint={`Current code window expires in ${totpWindowSecondsLeft}s.`}>
          <input
            className="ui-input"
            id="totpCode"
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        </FormRow>
        <p className="admin-note">If a code fails, wait for the timer to reset and enter the next one. Make sure your phone time is set automatically.</p>
        <button type="submit" className="ui-btn ui-btn--primary" disabled={!canVerify}>Verify and enable 2FA</button>
        <p className="admin-note">Lost access to your authenticator? Go back to <a href="/admin/login">admin login</a> and complete sign-in with a backup code.</p>
      </Card>

      {status ? <Alert tone="info">{status}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </main>
  )
}
