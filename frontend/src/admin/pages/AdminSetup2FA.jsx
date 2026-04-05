import { useMemo, useState } from 'react'

function readSetupToken() {
  const url = new URL(window.location.href)
  return url.searchParams.get('token') || ''
}

export default function AdminSetup2FA() {
  const [setupToken, setSetupToken] = useState(readSetupToken())
  const [totpCode, setTotpCode] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const canVerify = useMemo(() => setupToken && totpCode.trim().length >= 6, [setupToken, totpCode])

  async function beginSetup() {
    setError('')
    setStatus('Generating QR code…')

    try {
      const response = await fetch('/api/auth/admin/2fa/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Could not initialize 2FA')
      }

      setQrCodeDataUrl(payload.qrCodeDataUrl || '')
      setBackupCodes(payload.backupCodes || [])
      setStatus('2FA initialized. Save your backup codes and verify with your authenticator app.')
    } catch (requestError) {
      setStatus('')
      setError(requestError.message)
    }
  }

  async function verifySetup(event) {
    event.preventDefault()
    setError('')
    setStatus('Verifying code…')

    try {
      const response = await fetch('/api/auth/admin/2fa/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken, totpCode }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Could not verify 2FA')
      }

      setStatus('2FA enabled successfully. You can now sign in to the admin console.')
    } catch (requestError) {
      setStatus('')
      setError(requestError.message)
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1>Admin 2FA Setup</h1>
      <p>Scan the QR code in Google Authenticator (or compatible TOTP app), save backup codes, then verify.</p>

      <div style={{ display: 'grid', gap: 12 }}>
        <label htmlFor="setupToken">Setup token</label>
        <input id="setupToken" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} />
        <button type="button" onClick={beginSetup}>Generate QR and backup codes</button>
      </div>

      {qrCodeDataUrl ? (
        <section style={{ marginTop: 18 }}>
          <img src={qrCodeDataUrl} alt="Admin TOTP QR code" style={{ width: 240, height: 240 }} />
        </section>
      ) : null}

      {backupCodes.length > 0 ? (
        <section style={{ marginTop: 18 }}>
          <h2>Backup codes (print these down!)</h2>
          <ul>
            {backupCodes.map((code) => (
              <li key={code}><code>{code}</code></li>
            ))}
          </ul>
        </section>
      ) : null}

      <form onSubmit={verifySetup} style={{ marginTop: 18, display: 'grid', gap: 10 }}>
        <label htmlFor="totpCode">Authenticator code</label>
        <input id="totpCode" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="123456" />
        <button type="submit" disabled={!canVerify}>Verify and enable 2FA</button>
      </form>

      {status ? <p style={{ color: '#0369a1' }}>{status}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
    </main>
  )
}
