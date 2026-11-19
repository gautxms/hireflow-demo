import { useEffect, useRef, useState } from 'react'
import { submitGoogleAuth } from '../utils/googleAuthClient'

const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
let scriptPromise

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GOOGLE_SCRIPT_URL
      script.async = true
      script.onload = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in could not load.'))
      script.onerror = () => reject(new Error('Google sign-in could not load. Try again later.'))
      document.head.appendChild(script)
    }).catch((error) => {
      document.querySelector(`script[src="${GOOGLE_SCRIPT_URL}"]`)?.remove()
      scriptPromise = null
      throw error
    })
  }
  return scriptPromise
}

function finishSession(payload, onAuthSuccess) {
  if (!payload?.token || !payload?.user) throw new Error('Google sign-in returned an incomplete session.')
  onAuthSuccess(payload.token, payload.user.subscription_status || 'inactive', payload.user)
}

export default function GoogleAuthOption({ mode, onAuthSuccess }) {
  const buttonRef = useRef(null)
  const onAuthSuccessRef = useRef(onAuthSuccess)
  onAuthSuccessRef.current = onAuthSuccess
  const activeRef = useRef(true)
  const busyRef = useRef(false)
  const [step, setStep] = useState(null)
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    activeRef.current = true
    const button = buttonRef.current
    loadGoogleScript().then((google) => {
      if (cancelled || !button) return
      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID.trim(),
        callback: async ({ credential }) => {
          if (!activeRef.current || busyRef.current || !credential) return
          busyRef.current = true
          setBusy(true)
          setError('')
          try {
            const payload = await submitGoogleAuth('', { credential })
            if (!activeRef.current) return
            if (payload.token) finishSession(payload, onAuthSuccessRef.current)
            else if (['signup_required', 'link_required'].includes(payload.status) && payload.continuationToken && payload.email) {
              setStep({ status: payload.status, email: payload.email, continuationToken: payload.continuationToken })
            } else throw new Error('Google sign-in returned an unexpected response.')
          } catch (cause) {
            if (activeRef.current) setError(cause.message || 'Google sign-in failed. Try again.')
          } finally {
            busyRef.current = false
            if (activeRef.current) setBusy(false)
          }
        },
        ux_mode: 'popup',
        auto_select: false,
      })
      google.accounts.id.renderButton(button, {
        theme: 'filled_black', size: 'large', shape: 'rectangular', text: mode === 'signup' ? 'signup_with' : 'signin_with',
        width: Math.min(button.clientWidth, 380),
      })
    }).catch((cause) => {
      if (!cancelled) setError(cause.message)
    })
    return () => { cancelled = true; activeRef.current = false }
  }, [mode])

  const complete = async (event) => {
    event.preventDefault()
    if (busyRef.current || !step) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const isSignup = step.status === 'signup_required'
      const payload = await submitGoogleAuth(isSignup ? '/signup' : '/link', isSignup
        ? { continuationToken: step.continuationToken, company, phone, acceptTerms: acceptedTerms }
        : { continuationToken: step.continuationToken, password })
      if (activeRef.current) finishSession(payload, onAuthSuccessRef.current)
    } catch (cause) {
      if (activeRef.current) setError(cause.message || 'Unable to complete Google sign-in.')
    } finally {
      busyRef.current = false
      if (activeRef.current) setBusy(false)
    }
  }

  return (
    <div className="auth-google">
      <div className="auth-divider"><span>or continue with</span></div>
      <div className="auth-google__button" ref={buttonRef} hidden={Boolean(step)} />
      {step && (
        <form className="auth-form auth-google__completion" onSubmit={complete}>
          <h2 className="auth-google__title">{step.status === 'signup_required' ? 'Finish creating your account' : 'Connect your existing account'}</h2>
          <p className="auth-google__help">{step.status === 'signup_required'
            ? `Google verified ${step.email}. Confirm the terms to create your HireFlow account.`
            : `An account already exists for ${step.email}. Enter its HireFlow password to connect Google without losing your data.`}</p>
          {step.status === 'signup_required' ? <>
            <label className="auth-label" htmlFor="google-company">Company (optional)</label>
            <input className="auth-input" id="google-company" value={company} maxLength={100} onChange={(event) => setCompany(event.target.value)} />
            <label className="auth-label" htmlFor="google-phone">Phone (optional)</label>
            <input className="auth-input" id="google-phone" type="tel" placeholder="+14155552671" value={phone} onChange={(event) => setPhone(event.target.value)} />
            <label className="auth-checkbox-row" htmlFor="google-terms">
              <input id="google-terms" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required />
              <span>I agree to the <a className="auth-link" href="/terms">Terms</a> and <a className="auth-link" href="/privacy">Privacy Policy</a></span>
            </label>
          </> : <>
            <label className="auth-label" htmlFor="google-password">Current HireFlow password</label>
            <input className="auth-input" id="google-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <p className="auth-google__help">Forgot it? <a className="auth-link" href="/forgot-password">Reset your password</a> first.</p>
          </>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Connecting…' : step.status === 'signup_required' ? 'Create account' : 'Connect and sign in'}</button>
          <button className="auth-link auth-google__cancel" type="button" disabled={busy} onClick={() => { setStep(null); setPassword(''); setAcceptedTerms(false); setError('') }}>Cancel</button>
        </form>
      )}
      {busy && !step && <p className="auth-google__help" role="status">Signing in with Google…</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  )
}
