import { useState } from 'react'
import BackButton from '../components/BackButton'
import '../styles/pricing.css'

const PLAN_FEATURES = [
  'Unlimited resume uploads',
  'AI-powered candidate screening',
  'Bias-reduced scoring',
  'Secure data handling',
  'Email support',
]

const PRICING = {
  annual: {
    id: 'annual',
    name: 'Annual Plan',
    badge: 'Best Value',
    price: '$79',
    period: '/month',
    billing: 'Billed annually at $948/year',
    savings: 'Save $240 per year compared to monthly',
    trial: '7-day free trial, cancel anytime',
    cta: 'Start Annual',
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly Plan',
    badge: null,
    price: '$99',
    period: '/month',
    billing: 'Billed monthly',
    savings: null,
    trial: '7-day free trial, cancel anytime',
    cta: 'Start Monthly',
  },
}

const SHARED_PLAN_FEATURES = [
  'Unlimited AI resume analysis with no per-resume upload fees on active plans.',
  'AI-powered candidate screening to help surface stronger matches faster.',
  'Bias-reduced scoring signals designed to support more consistent shortlisting decisions.',
  'Bulk resume upload support so teams can process high-volume intake in fewer steps.',
  'Secure data handling built into the platform workflows used for parsing and analysis.',
  'Email support for setup, billing, and day-to-day product questions.',
]

const PRICING_FAQ = [
  {
    question: 'Can I change my plan later?',
    answer: 'Yes. You can switch between monthly and annual billing as your hiring needs change. If your team hires in cycles, many customers start monthly and move to annual once usage is predictable. Your access to the product remains the same core experience, and billing updates are applied at the next billing cycle so changes are straightforward and easy to plan around.',
  },
  {
    question: 'Is there a free trial?',
    answer: 'Yes. Both plans include a 7-day free trial so you can test Hireflow with real hiring workflows before you commit. The trial is intended to give you enough time to upload resumes, review AI scoring output, and confirm the platform fits your process. If you cancel during the trial window, you are not charged for the subscription.',
  },
  {
    question: 'How does billing work?',
    answer: 'Hireflow offers two billing schedules: monthly billing at $99 per month, or annual billing at an effective $79 per month billed as $948 per year. The annual option is discounted compared with paying month-to-month for a full year. Your selected billing cadence is shown clearly during checkout so your finance or operations team can review totals before purchase.',
  },
  {
    question: 'What happens when I reach my resume limit?',
    answer: 'For the plans shown on this page, resume uploads are unlimited, so there is no hard per-resume cap to hit during normal usage. That means your team can continue screening candidates without interruption when hiring volume increases. If your organization has unique governance, procurement, or scale requirements, you can still contact the team to discuss a tailored arrangement.',
  },
  {
    question: 'Do you offer discounts for annual plans?',
    answer: 'Yes. Annual billing is discounted and saves $240 per year versus paying monthly for 12 months. Teams that know they will be hiring regularly often choose annual billing for the lower effective monthly cost and simpler budget planning. If you prefer more flexibility in the short term, monthly billing remains available and you can switch later.',
  },
]

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function PricingCard({ plan, selected, emphasized, onStartCheckout, loading }) {
  return (
    <article
      className={`pricing-card ${selected ? 'is-selected' : ''} ${emphasized ? 'is-emphasized' : ''}`}
      aria-label={plan.name}
    >
      {plan.badge && <span className="pricing-card__badge">{plan.badge}</span>}

      <h2 className="pricing-card__title">{plan.name}</h2>

      <p className="pricing-card__price">
        {plan.price}
        <span className="pricing-card__period">{plan.period}</span>
      </p>

      <p className="pricing-card__billing">{plan.billing}</p>
      {plan.savings && <p className="pricing-card__savings">{plan.savings}</p>}
      <p className="pricing-card__trial">{plan.trial}</p>

      <button
        type="button"
        onClick={() => onStartCheckout(plan.id)}
        disabled={loading}
        className={`pricing-card__cta ${selected ? 'is-selected' : ''}`}
      >
        {loading ? 'Preparing checkout…' : plan.cta}
      </button>

      <ul className="pricing-card__features">
        {PLAN_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </article>
  )
}

export default function Pricing({ isAuthenticated, onRequireAuth }) {
  const [selectedBilling, setSelectedBilling] = useState('annual')

  const startCheckout = (plan) => {
    if (!isAuthenticated) {
      onRequireAuth('Please log in or sign up to purchase a plan.')
      return
    }

    navigate(`/checkout?plan=${plan}`)
  }

  return (
    <main className="pricing-page">
      <section className="pricing-page__content">
        <div className="pricing-page__back">
          <BackButton />
        </div>

        <h1 className="pricing-page__title">Choose your plan</h1>
        <p className="pricing-page__subtitle">
          7-day free trial, cancel anytime.
        </p>
        <p className="pricing-page__intro">
          Hireflow gives recruiting teams a straightforward way to evaluate candidates with AI support, without confusing add-ons or hidden pricing mechanics.
          Our pricing is designed to stay simple as you grow, whether you are handling a handful of roles or ongoing, high-volume hiring.
          You get the same core platform experience across plans, with billing options that match how your team prefers to budget.
          No per-resume upload fees, no surprise platform charges, and clear plan terms from day one.
        </p>

        <div className="pricing-page__toggle-wrap">
          <div
            role="tablist"
            aria-label="Billing frequency"
            className="pricing-page__toggle"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedBilling === 'monthly'}
              onClick={() => setSelectedBilling('monthly')}
              className={`pricing-page__toggle-button ${selectedBilling === 'monthly' ? 'is-selected' : ''}`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedBilling === 'annual'}
              onClick={() => setSelectedBilling('annual')}
              className={`pricing-page__toggle-button ${selectedBilling === 'annual' ? 'is-selected' : ''}`}
            >
              Annual
            </button>
          </div>
        </div>

        <p className="pricing-page__price-note">
          {selectedBilling === 'annual' ? '$79/month (billed annually at $948/year)' : '$99/month billed monthly'}
        </p>

        <div className="pricing-page__grid">
          <PricingCard
            plan={PRICING.annual}
            selected={selectedBilling === 'annual'}
            emphasized
            onStartCheckout={startCheckout}
            loading={false}
          />
          <PricingCard
            plan={PRICING.monthly}
            selected={selectedBilling === 'monthly'}
            emphasized={false}
            onStartCheckout={startCheckout}
            loading={false}
          />
        </div>

        <section className="pricing-page__section" aria-labelledby="shared-features-heading">
          <h2 id="shared-features-heading" className="pricing-page__section-title">What&apos;s included in each plan</h2>
          <p className="pricing-page__section-copy">
            Every paid Hireflow plan includes the same essential recruiting workflow capabilities so you can focus on hiring outcomes, not feature gates.
            The main difference is billing cadence, not access to core value.
          </p>
          <ul className="pricing-page__section-list">
            {SHARED_PLAN_FEATURES.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </section>

        <section className="pricing-page__section" aria-labelledby="fit-heading">
          <h2 id="fit-heading" className="pricing-page__section-title">Is Hireflow right for me?</h2>
          <p className="pricing-page__section-copy">
            <strong>Solo recruiters and small teams:</strong> If you are wearing multiple hats and need to move faster, Hireflow helps you screen resumes consistently without adding heavy process.
            You can upload candidates in bulk, review AI-assisted scoring, and spend more of your time on interviews and stakeholder coordination instead of manual triage.
          </p>
          <p className="pricing-page__section-copy">
            <strong>Growing HR departments:</strong> If your company is scaling and hiring demand changes month to month, Hireflow provides a predictable platform with transparent billing.
            Teams can standardize candidate review criteria, reduce bottlenecks in early-stage screening, and keep hiring operations organized as requisition volume increases.
          </p>
          <p className="pricing-page__section-copy">
            <strong>Recruitment agencies:</strong> If you support multiple clients and need repeatable quality across different roles, Hireflow can streamline intake and first-pass evaluation.
            The unlimited upload model is especially helpful for agencies that need flexibility while maintaining delivery speed and consistent screening standards.
          </p>
        </section>

        <section className="pricing-page__section" aria-labelledby="pricing-faq-heading">
          <h2 id="pricing-faq-heading" className="pricing-page__section-title">Frequently asked questions about pricing</h2>
          <div className="pricing-page__faq-list">
            {PRICING_FAQ.map((item) => (
              <article key={item.question} className="pricing-page__faq-item">
                <h3 className="pricing-page__faq-question">{item.question}</h3>
                <p className="pricing-page__faq-answer">{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <p className="pricing-page__trust-line">
          Trusted by hiring teams that want transparent pricing and reliable AI-assisted screening workflows.
        </p>
      </section>

    </main>
  )
}
