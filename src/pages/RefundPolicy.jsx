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

export default function RefundPolicy() {
  usePageSeo('Refund Policy – Hireflow', 'Read Hireflow’s refund policy, including trial terms, non-refundable payments after conversion, and billing support contact information.')

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.25rem', lineHeight: 1.75 }}>
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
        <article aria-label="Refund Policy">
          <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', lineHeight: 1.2 }}>Refund Policy</h1>
          <p>
            Hireflow offers a 7-day free trial on all subscription plans.
          </p>
          <p>
            Once a subscription converts to a paid plan, payments are non-refundable.
          </p>
          <p>
            You may cancel your subscription at any time to prevent future charges.
          </p>
          <p>
            If you believe you were charged in error, please contact us at{' '}
            <a href="mailto:hello@gfactai.com" style={{ color: 'var(--accent)' }}>hello@gfactai.com</a>.
          </p>
          <p>
            This policy complies with Paddle’s merchant and billing requirements.
          </p>
        </article>
      </main>
    </div>
  )
}
