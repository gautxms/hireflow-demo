import { useState } from 'react'
import DOMPurify from 'dompurify'
import './AuthPage.css'
import BackButton from './BackButton'
import API_BASE from '../config/api'

const E164_REGEX = /^\+[1-9]\d{1,14}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COMPANY_REGEX = /^[a-zA-Z0-9\-\s]*$/

function sanitizeForDisplay(message) {
  return DOMPurify.sanitize(message ?? '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

function getInlineErrors({ email, company, phone, password, confirmPassword, acceptedTerms }) {
  const errors = {}

  if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
    errors.email = 'Enter a valid email address.'
  }

  if (company && (!COMPANY_REGEX.test(company) || company.length > 100)) {
    errors.company = 'Company must be 100 characters or fewer and only include letters, numbers, spaces, or dashes.'
  }

  if (phone && !E164_REGEX.test(phone.trim())) {
    errors.phone = 'Phone must use E.164 format (example: +14155552671).'
  }

  if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters long.'
  }

  if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  if (!acceptedTerms) {
    errors.acceptedTerms = 'You must agree to the Terms and Privacy Policy to continue.'
  }

  return errors
}

export default function SignupPage({ onSignupSuccess, onGoToLogin }) {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    const inlineErrors = getInlineErrors({ email, company, phone, password, confirmPassword, acceptedTerms })
    setFieldErrors(inlineErrors)

    if (Object.keys(inlineErrors).length > 0) {
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, company, phone }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        if (Array.isArray(payload?.details)) {
          const nextFieldErrors = {}
          payload.details.forEach((detail) => {
            if (detail?.field && detail?.message) {
              nextFieldErrors[detail.field] = sanitizeForDisplay(detail.message)
            }
          })
          setFieldErrors(nextFieldErrors)
        }

        setError(sanitizeForDisplay(payload?.error || `Unable to sign up (${response.status})`))
        return
      }

      onSignupSuccess(email.trim().toLowerCase())
    } catch {
      setError('Unable to connect to the auth server. Check the backend URL and CORS settings.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <BackButton />
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Start ranking resumes in minutes.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="signup-email">Email <span className="auth-required">*</span></label>
          <input className="auth-input" id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {fieldErrors.email && <p className="auth-error">{fieldErrors.email}</p>}

          <label className="auth-label" htmlFor="signup-company">Company</label>
          <input className="auth-input" id="signup-company" type="text" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={100} />
          {fieldErrors.company && <p className="auth-error">{fieldErrors.company}</p>}

          <label className="auth-label" htmlFor="signup-phone">Phone</label>
          <input className="auth-input" id="signup-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14155552671" />
          {fieldErrors.phone && <p className="auth-error">{fieldErrors.phone}</p>}

          <label className="auth-label" htmlFor="signup-password">Password <span className="auth-required">*</span></label>
          <div className="auth-input-with-action">
            <input className="auth-input" id="signup-password" type={isPasswordVisible ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <button
              className="auth-input-action"
              type="button"
              aria-label={isPasswordVisible ? 'Hide password fields' : 'Show password fields'}
              title={isPasswordVisible ? 'Hide password fields' : 'Show password fields'}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              👁
            </button>
          </div>
          {fieldErrors.password && <p className="auth-error">{fieldErrors.password}</p>}

          <label className="auth-label" htmlFor="signup-confirm-password">Confirm password <span className="auth-required">*</span></label>
          <input className="auth-input" id="signup-confirm-password" type={isPasswordVisible ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
          {fieldErrors.confirmPassword && <p className="auth-error">{fieldErrors.confirmPassword}</p>}

          <label className="auth-checkbox-row" htmlFor="signup-terms">
            <input id="signup-terms" type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
            <span>I agree to the <a className="auth-link" href="/terms">Terms</a> and <a className="auth-link" href="/privacy">Privacy Policy</a></span>
          </label>
          {fieldErrors.acceptedTerms && <p className="auth-error">{fieldErrors.acceptedTerms}</p>}

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Sign up'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <button className="auth-link" type="button" onClick={onGoToLogin}>Log in</button>
        </p>
      </section>
    </main>
  )
}
