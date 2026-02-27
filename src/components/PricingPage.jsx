export default function PricingPage({ onStartTrial, onBack }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0f172a 0%, #111827 50%, #0b1220 100%)',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: '3rem 1.25rem',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            color: '#cbd5e1',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '0.5rem 0.9rem',
            cursor: 'pointer',
            marginBottom: '2rem',
          }}
        >
          ← Back
        </button>

        <header style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginBottom: '0.75rem' }}>Simple pricing for growing teams</h1>
          <p style={{ color: '#cbd5e1', margin: 0 }}>Everything you need to evaluate candidates faster.</p>
        </header>

        <section
          style={{
            maxWidth: 560,
            margin: '0 auto',
            background: '#111827',
            border: '1px solid #334155',
            borderRadius: 16,
            padding: '2rem',
            boxShadow: '0 20px 40px rgba(2, 6, 23, 0.45)',
          }}
        >
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.8rem' }}>
            Pro Plan
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0.75rem 0 1.5rem' }}>
            <span style={{ fontSize: '3rem', fontWeight: 800, lineHeight: 1 }}>$99</span>
            <span style={{ color: '#cbd5e1', fontSize: '1.1rem' }}>/month</span>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
            {['7-day free trial', 'Cancel anytime'].map((item) => (
              <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#e2e8f0' }}>
                <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={onStartTrial}
            style={{
              width: '100%',
              marginTop: '1.75rem',
              background: '#eab308',
              color: '#0f172a',
              border: 'none',
              borderRadius: 10,
              padding: '0.85rem 1rem',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Start Free Trial
          </button>
        </section>
      </div>
    </div>
  )
}
