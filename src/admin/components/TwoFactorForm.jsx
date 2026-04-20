import { useEffect, useMemo, useState } from 'react'

function normalize(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
}

function secondsUntilNextTotpWindow(periodSeconds = 30, nowMs = Date.now()) {
  const nowInSeconds = Math.floor(nowMs / 1000)
  return periodSeconds - (nowInSeconds % periodSeconds)
}

export default function TwoFactorForm({ onVerify, isSubmitting = false, totpPeriodSeconds = 30 }) {
  const [totpCode, setTotpCode] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [clockTick, setClockTick] = useState(() => Date.now())

  const canSubmit = useMemo(() => normalize(totpCode).length >= 6 || normalize(backupCode).length >= 6, [totpCode, backupCode])
  const totpWindowSecondsLeft = useMemo(
    () => secondsUntilNextTotpWindow(totpPeriodSeconds, clockTick),
    [clockTick, totpPeriodSeconds],
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

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
      <h3>Step 3 of 3: Two-factor verification</h3>
      <p style={{ margin: 0, color: 'var(--admin-text-muted)' }}>
        Enter a 6-digit authenticator code or a one-time backup code. A new authenticator code appears every {totpPeriodSeconds} seconds.
      </p>
      <p style={{ margin: 0, color: 'var(--admin-text)' }}>
        Current authenticator window expires in <strong>{totpWindowSecondsLeft}s</strong>.
      </p>

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

      <small style={{ color: 'var(--admin-text-muted)' }}>
        Can’t access your authenticator app? Use one backup code above. If you are out of backup codes, contact another admin to rotate 2FA access.
      </small>
    </form>
  )
}
