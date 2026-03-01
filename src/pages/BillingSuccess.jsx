import usePageSeo from '../hooks/usePageSeo'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

export default function BillingSuccess() {
  usePageSeo('Billing Success', 'Your HireFlow subscription checkout completed successfully.')

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--ink)', color: 'var(--text)', padding: '1rem' }}>
      <section style={{ maxWidth: 560, width: '100%', border: '1px solid var(--border)', borderRadius: 16, background: 'var(--card)', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>Subscription started 🎉</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.2rem' }}>
          Your checkout completed successfully. You can now continue using HireFlow.
        </p>
        <button type="button" onClick={() => navigate('/')} style={{ border: 'none', borderRadius: 8, background: 'var(--accent)', color: 'var(--ink)', padding: '0.75rem 1.2rem', fontWeight: 700, cursor: 'pointer' }}>
          Go to Dashboard
        </button>
      </section>
    </main>
  )
}
