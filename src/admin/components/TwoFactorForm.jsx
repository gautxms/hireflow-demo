import { useMemo, useState } from 'react'

function normalize(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
}

export default function TwoFactorForm({ onVerify, isSubmitting = false }) {
  const [totpCode, setTotpCode] = useState('')
  const [backupCode, setBackupCode] = useState('')

  const canSubmit = useMemo(() => normalize(totpCode).length >= 6 || normalize(backupCode).length >= 6, [totpCode, backupCode])

  const handleSubmit = async (event) => {
    event.preventDefault()

    await onVerify({
      totpCode: normalize(totpCode),
      backupCode: normalize(backupCode),
    })

    setBackupCode('')
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
      <h3>Two-factor verification</h3>
      <p style={{ margin: 0, color: '#475569' }}>Enter a 6-digit authenticator code or a one-time backup code.</p>

      <label htmlFor="totpCode">Authenticator code</label>
      <input
        id="totpCode"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={totpCode}
        onChange={(event) => setTotpCode(event.target.value)}
      />

      <label htmlFor="backupCode">Backup code</label>
      <input
        id="backupCode"
        placeholder="XXXX-XXXX"
        value={backupCode}
        onChange={(event) => setBackupCode(event.target.value)}
      />

      <button type="submit" disabled={!canSubmit || isSubmitting}>
        {isSubmitting ? 'Verifying…' : 'Verify and sign in'}
      </button>
    </form>
  )
}
