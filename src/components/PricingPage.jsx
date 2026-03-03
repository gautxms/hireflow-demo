import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from './PublicFooter'

const headerLinkStyle = {
  color: 'var(--muted)',
  textDecoration: 'none',
  fontSize: '0.95rem'
}

export default function PricingPage() {
  usePageSeo('HireFlow Pricing', 'HireFlow pricing details with a 7-day free trial and flexible monthly billing.')

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '1rem 2rem' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 700, fontSize: '1.1rem' }}>
            Hire<span style={{ color: 'var(--accent)' }}>Flow</span>
          </a>
          <nav style={{ display: 'flex', gap: '1.25rem' }}>
            <a href="/" style={headerLinkStyle}>Home</a>
            <a href="/pricing" style={headerLinkStyle}>Pricing</a>
            <a href="/privacy" style={headerLinkStyle}>Privacy</a>
            <a href="/terms" style={headerLinkStyle}>Terms</a>
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, padding: '4rem 1.5rem', display: 'grid', placeItems: 'center' }}>
        <section style={{ width: '100%', maxWidth: 680, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)', padding: '2rem' }}>
          <h1 style={{ fontSize: '2.2rem', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>Pricing</h1>
          <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>Simple monthly pricing for teams that want faster hiring.</p>

          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.1 }}>$99<span style={{ fontSize: '1rem', color: 'var(--muted)', fontWeight: 400 }}>/month</span></p>
          </div>

          <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.75rem', color: 'var(--muted)' }}>
            <li>7-day free trial</li>
            <li>Cancel anytime</li>
          </ul>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
