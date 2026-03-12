import usePageSeo from '../hooks/usePageSeo'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function goBack() {
  navigate('/')
}

export default function PrivacyPage() {
  usePageSeo('HireFlow Privacy Policy', 'Learn how HireFlow collects, uses, and protects personal information processed on our hiring platform.')

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '4rem 1.5rem', lineHeight: 1.7 }}>
        <button
          type="button"
          onClick={goBack}
          style={{
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--accent)',
            borderRadius: 8,
            padding: '0.55rem 0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '1.25rem',
          }}
        >
          ← Back
        </button>
        <h1 style={{ marginBottom: '1.5rem', fontFamily: 'var(--font-display)' }}>Privacy Policy</h1>
        <p>HireFlow processes business and candidate data to provide recruiting automation features for customers.</p>
        <h2>Information We Collect</h2>
        <p>We collect account information, workflow configuration, and content voluntarily submitted through the platform, including resumes and evaluation notes.</p>
        <h2>How We Use Information</h2>
        <p>Data is used to operate, secure, and improve HireFlow, provide customer support, and meet legal obligations.</p>
        <h2>Data Sharing</h2>
        <p>We do not sell personal information. Data may be shared with service providers who process data on our behalf under contractual protections.</p>
        <h2>Security and Retention</h2>
        <p>We apply technical and organizational safeguards to protect data and retain information only as long as necessary for legitimate business or legal needs.</p>
        <h2>Your Choices</h2>
        <p>You may request access, correction, or deletion of personal information where applicable law grants these rights by contacting privacy@hireflow.example.</p>
      </main>
    </div>
  )
}
