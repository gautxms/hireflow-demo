import { useMemo, useState } from 'react'

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

export default function AdminSetup2FA() {
  const [setupToken, setSetupToken] = useState(readToken())
  const [totpCode, setTotpCode] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const canVerify = useMemo(() => setupToken.trim().length > 0 && totpCode.trim().length >= 6, [setupToken, totpCode])

  async function beginSetup() {
    setError('')
    setStatus('Generating QR code and backup codes…')

    const response = await fetch('/api/auth/admin/2fa/setup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      setStatus('')
      setError(payload.error || 'Unable to initialize 2FA setup')
      return
    }

    const incomingCodes = Array.isArray(payload.backupCodes) ? payload.backupCodes.slice(0, 10) : []
    setQrCodeDataUrl(payload.qrCodeDataUrl || '')
    setBackupCodes(incomingCodes)
    setStatus('Scan the QR code, store your backup codes safely, then verify.')
  }

  async function verifyCode(event) {
    event.preventDefault()
    setError('')
    setStatus('Verifying authenticator code…')

    const response = await fetch('/api/auth/admin/2fa/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, totpCode }),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      setStatus('')
      setError(payload.error || 'Verification failed')
      return
    }

    setStatus('2FA is enabled. Continue to admin login.')
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>Admin 2FA Setup Wizard</h1>
      <p>Step 1: generate QR code and 10 backup codes. Step 2: verify with Google Authenticator.</p>

      <div style={{ display: 'grid', gap: 10 }}>
        <label htmlFor="setupToken">Setup token</label>
        <input id="setupToken" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} />
        <button type="button" onClick={beginSetup}>Generate QR + backup codes</button>
      </div>

      {qrCodeDataUrl ? (
        <section style={{ marginTop: 16 }}>
          <h2>Scan in authenticator app</h2>
          <img src={qrCodeDataUrl} alt="Admin TOTP QR code" style={{ width: 220, height: 220 }} />
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
        <input id="totpCode" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="123456" />
        <button type="submit" disabled={!canVerify}>Verify and enable 2FA</button>
      </form>

      {status ? <p style={{ color: '#0369a1' }}>{status}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
    </main>
  )
}
