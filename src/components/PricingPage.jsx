import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from './PublicFooter'

export default function PricingPage() {
  usePageSeo('HireFlow Pricing', 'Explore HireFlow pricing plans for teams of every size, from starter recruiting workflows to enterprise hiring operations.')
  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$99',
      period: '/month',
      description: 'Perfect for small teams just getting started',
      features: [
        'Up to 50 resumes/month',
        'Basic AI scoring',
        'Email integration',
        'Up to 2 team members',
        'Email support'
      ],
      cta: 'Get Started',
      highlighted: false
    },
    {
      id: 'pro',
      name: 'Pro',
      price: '$299',
      period: '/month',
      description: 'For growing teams with high hiring velocity',
      features: [
        'Up to 500 resumes/month',
        'Advanced AI scoring (20+ dimensions)',
        'Email & Slack integration',
        'Up to 10 team members',
        'Priority support',
        'Custom scoring rules',
        'Candidate analytics'
      ],
      cta: 'Get Started',
      highlighted: true
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 'Custom',
      period: 'pricing',
      description: 'For large orgs with custom requirements',
      features: [
        'Unlimited resumes',
        'Custom AI models',
        'Full API access',
        'Unlimited team members',
        'Dedicated support',
        'SSO & compliance',
        'On-premise deployment'
      ],
      cta: 'Contact Sales',
      highlighted: false
    }
  ]

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Simple, Transparent Pricing
        </h1>
        <p style={{ fontSize: '1.1rem', color: 'var(--muted)', maxWidth: '600px', margin: '0 auto' }}>
          Choose the plan that fits your hiring needs. Scale up anytime.
        </p>
      </div>

      {/* Pricing Cards */}
      <div style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
          {plans.map(plan => (
            <div
              key={plan.id}
              style={{
                border: plan.highlighted ? '2px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: '12px',
                padding: '2.5rem',
                background: plan.highlighted ? 'rgba(232,255,90,0.05)' : 'var(--card)',
                position: 'relative',
                transform: plan.highlighted ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 0.3s ease'
              }}
            >
              {plan.highlighted && (
                <div style={{
                  position: 'absolute',
                  top: '-12px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: 'bold'
                }}>
                  MOST POPULAR
                </div>
              )}

              <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                {plan.name}
              </h3>
              <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                {plan.description}
              </p>

              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>
                  {plan.price}
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{plan.period}</span>
                </div>
              </div>

              <button
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  marginBottom: '2rem',
                  background: plan.highlighted ? 'var(--accent)' : 'transparent',
                  color: plan.highlighted ? 'var(--ink)' : 'var(--accent)',
                  border: plan.highlighted ? 'none' : '2px solid var(--accent)',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'all 0.2s'
                }}
              >
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

      {/* FAQ Section */}
      <div style={{ padding: '4rem 2rem', borderTop: '1px solid var(--border)', background: 'var(--ink-2)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
          Frequently Asked Questions
        </h2>

        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'grid', gap: '2rem' }}>
          {[
            { q: 'Can I change plans anytime?', a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect on your next billing cycle.' },
            { q: 'What if I need more resumes?', a: 'Contact our sales team for custom volume packages. We offer discounts for high-volume users.' },
            { q: 'Is there a free trial?', a: 'Yes! Start with 14 days free on any plan. No credit card required.' },
            { q: 'Do you offer annual billing?', a: 'Yes, save 20% with annual billing. Available on all plans.' }
          ].map((item, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem' }}>
              <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>{item.q}</h4>
              <p style={{ color: 'var(--muted)', lineHeight: '1.6' }}>{item.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Ready to hire smarter?
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '1.1rem' }}>
          Start your free trial today. No credit card required.
        </p>
        <button
          style={{
            background: 'var(--accent)',
            color: 'var(--ink)',
            border: 'none',
            padding: '0.75rem 2rem',
            borderRadius: '6px',
            fontWeight: 'bold',
            fontSize: '1rem',
            cursor: 'pointer'
          }}
        >
          Start Free Trial
        </button>
      </div>

      <PublicFooter />
    </div>
  )
}
