import './AuthPage.css'

export default function VerifyEmailInfoPage({ onBackToLogin }) {
  const handleResendVerification = () => undefined

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">Check your email to verify your account before logging in.</p>

        <div className="auth-form">
          <button className="auth-submit" type="button" onClick={handleResendVerification}>Resend verification email</button>
        </div>

        <p className="auth-switch">
          <button className="auth-link" type="button" onClick={onBackToLogin}>Back to Login</button>
        </p>
      </section>
    </main>
  )
}
