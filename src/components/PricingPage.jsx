import usePageSeo from '../hooks/usePageSeo'
import PublicPageLayout from './public/PublicPageLayout'
import '../styles/pricing-page-marketing.css'

const FAQ_ITEMS = [
  { q: 'Can I change plans anytime?', a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect on your next billing cycle.' },
  { q: 'What if I need more resumes?', a: 'Contact our sales team for custom volume packages. We offer discounts for high-volume users.' },
  { q: 'Is there a free trial?', a: 'Yes! Start with 14 days free on any plan. No credit card required.' },
  { q: 'Do you offer annual billing?', a: 'Yes, save 20% with annual billing. Available on all plans.' }
]

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
    <PublicPageLayout>
      <section className="public-section pricing-marketing-page__header">
        <h1 className="pricing-marketing-page__title">Simple, Transparent Pricing</h1>
        <p className="pricing-marketing-page__subtitle">Choose the plan that fits your hiring needs. Scale up anytime.</p>
      </section>

      <section className="public-section pricing-marketing-page__cards-section">
        <div className="pricing-marketing-page__cards-grid">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={`pricing-marketing-card ${plan.highlighted ? 'pricing-marketing-card--highlighted' : ''}`}
            >
              {plan.highlighted && <div className="pricing-marketing-card__badge">MOST POPULAR</div>}

              <h3 className="pricing-marketing-card__title">{plan.name}</h3>
              <p className="pricing-marketing-card__description">{plan.description}</p>

              <p className="pricing-marketing-card__price">
                {plan.price}
                <span className="pricing-marketing-card__period">{plan.period}</span>
              </p>

              <button
                type="button"
                className={`pricing-marketing-card__cta ${plan.highlighted ? 'pricing-marketing-card__cta--highlighted' : ''}`}
              >
                {plan.cta}
              </button>

              <ul className="pricing-marketing-card__features">
                {plan.features.map((feature) => (
                  <li key={feature} className="pricing-marketing-card__feature-item">
                    <span className="pricing-marketing-card__check" aria-hidden="true">✓</span>
                    <span className="pricing-marketing-card__feature-text">{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section pricing-marketing-page__faq-section">
        <h2 className="pricing-marketing-page__section-title">Frequently Asked Questions</h2>

        <div className="pricing-marketing-page__faq-list">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q} className="pricing-marketing-page__faq-item">
              <h4 className="pricing-marketing-page__faq-question">{item.q}</h4>
              <p className="pricing-marketing-page__faq-answer">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="public-section pricing-marketing-page__cta-section">
        <h2 className="pricing-marketing-page__section-title">Ready to hire smarter?</h2>
        <p className="pricing-marketing-page__cta-copy">Start your free trial today. No credit card required.</p>
        <button type="button" className="pricing-marketing-page__cta-button">Start Free Trial</button>
      </section>

    </PublicPageLayout>
  )
}
