export default function PricingPage({ onSelectPlan, onBack }) {
  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$99',
      period: '/month',
      description: 'For early teams that need faster resume review.',
      features: [
        'Resume upload and parsing',
        'Parsed candidate details view',
        'Basic team workspace',
        'Email support during beta'
      ],
      cta: 'Request Access',
      highlighted: true
    }
  ]

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <div style={{ borderBottom: '1px solid var(--border)', padding: '2rem 2rem 4rem', textAlign: 'center' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1.5rem' }}>← Back</button>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Pricing for Beta Teams
        </h1>
        <p style={{ fontSize: '1.1rem', color: 'var(--muted)', maxWidth: '600px', margin: '0 auto 1rem' }}>
          We currently offer one early-access plan while the product is in MVP beta.
        </p>
        <div style={{ color: 'var(--accent)', fontWeight: 'bold' }}>Limited availability during beta</div>
      </div>

      <div style={{ padding: '4rem 2rem', maxWidth: '760px', margin: '0 auto' }}>
        {plans.map(plan => (
          <div key={plan.id} style={{ border: '2px solid var(--accent)', borderRadius: '12px', padding: '2.5rem', background: 'rgba(232,255,90,0.05)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: 'var(--ink)', padding: '0.4rem 0.9rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
              FREE BETA ACCESS
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{plan.name}</h3>
            <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>{plan.description}</p>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{plan.price}<span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{plan.period}</span></div>
            </div>
            <button onClick={() => onSelectPlan(plan.id)} style={{ width: '100%', padding: '0.75rem', marginBottom: '2rem', background: 'var(--accent)', color: 'var(--ink)', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' }}>
              {plan.cta}
            </button>
            <div style={{ display: 'grid', gap: '1rem' }}>
              {plan.features.map((feature, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent-2)', marginTop: '2px' }}>✓</span>
                  <span style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
