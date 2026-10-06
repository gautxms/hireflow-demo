import { useState } from 'react'
import BackButton from '../components/BackButton'
import { PRICING_TIERS } from '../config/pricingPlans'
import '../styles/pricing.css'

const PLAN_FEATURES = [
  'AI-powered candidate screening',
  'Structured scoring signals',
  'Responsible AI and privacy-conscious workflows',
  'Email support',
]

const SHARED_PLAN_FEATURES = [
  'AI-powered candidate screening to help surface stronger matches faster.',
  'Structured scoring signals designed to support more consistent shortlisting decisions.',
  'Bulk resume upload support so teams can process high-volume intake in fewer steps.',
  'Upload validation, rate limiting, and recruiter-led review for responsible AI workflows.',
  'Email support for setup, billing, and day-to-day product questions.',
]

const PRICING_FAQ = [
  {
    question: 'Can I change my plan later?',
    answer: 'Yes. Cancel your current subscription from Billing; you keep access through the end of the paid period. Once it ends, choose a new plan and complete checkout at the price shown. There is no automatic plan switch, prorated charge, or second free trial.',
  },
  {
    question: 'Is there a free trial?',
    answer: 'Eligible new accounts can use one 7-day free trial to test Hireflow before committing. A trial is not reinstated after cancellation, payment failure, pausing, or a previous subscription. Returning subscribers are charged when checkout completes.',
  },
  {
    question: 'How does billing work?',
    answer: 'Choose Starter, Growth, or Pro, then pay monthly or annually. Starter is $29/month or $290/year; Growth is $59/month or $590/year; Pro is $99/month or $999/year. You can review the total in Paddle before paying.',
  },
  {
    question: 'What happens when I reach my resume limit?',
    answer: 'Starter includes 100, Growth 300, and Pro 800 resume analyses per month. Once you reach your plan limit, you can review existing work but cannot start another analysis until the allowance resets. To switch plans, cancel your current subscription and choose a new plan after its access ends.',
  },
  {
    question: 'Do you offer discounts for annual plans?',
    answer: 'Yes. Annual billing costs less than 12 monthly payments at the same tier. The resume analysis allowance remains monthly and resets each month, even with annual billing.',
  },
]

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function PricingCard({ tier, billing, onStartCheckout, trialAvailable }) {
  const annual = billing === 'annual'
  const planCode = annual ? tier.annualCode : tier.monthlyCode
  const amount = annual ? tier.annualAmount : tier.monthlyAmount
  const annualSavings = tier.monthlyAmount * 12 - tier.annualAmount

  return (
    <article
      className={`pricing-card ${tier.id === 'growth' ? 'is-emphasized' : ''}`}
      aria-label={`${tier.name} ${billing}`}
    >
      {tier.id === 'growth' && <span className="pricing-card__badge">For growing teams</span>}

      <h2 className="pricing-card__title">{tier.name}</h2>

      <p className="pricing-card__price">
        ${amount}
        <span className="pricing-card__period">/{annual ? 'year' : 'month'}</span>
      </p>

      <p className="pricing-card__billing">{annual ? 'Billed annually' : 'Billed monthly'} · {tier.monthlyLimit} resume analyses/month</p>
      {annual && <p className="pricing-card__savings">Save ${annualSavings}/year compared with monthly</p>}
      <p className="pricing-card__trial">{trialAvailable ? '7-day free trial for eligible new accounts' : 'Returning subscription — billed immediately'}</p>

      <button
        type="button"
        onClick={() => onStartCheckout(planCode)}
        className={`pricing-card__cta ${tier.id === 'growth' ? 'is-selected' : ''}`}
      >
        {trialAvailable ? `Start ${tier.name}` : `Subscribe to ${tier.name}`}
      </button>

      <ul className="pricing-card__features">
        <li>{tier.monthlyLimit} resume analyses per month</li>
        {PLAN_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </article>
  )
}

export default function Pricing({ isAuthenticated, onRequireAuth, trialEligible = true }) {
  const [selectedBilling, setSelectedBilling] = useState('annual')
  const trialAvailable = trialEligible !== false

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
          {trialAvailable ? '7-day free trial for eligible new accounts, cancel anytime.' : 'Choose a paid plan to restart your HireFlow subscription.'}
        </p>
        <p className="pricing-page__intro">
          Hireflow gives recruiting teams a straightforward way to evaluate candidates with AI support, without confusing add-ons or hidden pricing mechanics.
          Our pricing is designed to stay simple as you grow, whether you are handling a handful of roles or ongoing, high-volume hiring.
          You get the same core platform experience across plans, with a monthly resume analysis allowance that matches your team&apos;s needs.
          Choose monthly or annual billing and see the total before checkout.
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
          {selectedBilling === 'annual' ? 'Annual prices are billed once per year; analysis limits reset monthly.' : 'Monthly prices are billed each month.'}
        </p>

        <div className="pricing-page__grid">
          {PRICING_TIERS.map((tier) => (
            <PricingCard
              key={tier.id}
              tier={tier}
              billing={selectedBilling}
              onStartCheckout={startCheckout}
              trialAvailable={trialAvailable}
            />
          ))}
        </div>

        <section className="pricing-page__section" aria-labelledby="shared-features-heading">
          <h2 id="shared-features-heading" className="pricing-page__section-title">What&apos;s included in each plan</h2>
          <p className="pricing-page__section-copy">
            Every paid Hireflow plan includes the same essential recruiting workflow capabilities so you can focus on hiring outcomes, not feature gates.
            The monthly resume analysis allowance and price vary by tier. Billing cadence does not change your monthly allowance.
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
            Growth and Pro offer higher monthly analysis allowances for agencies that need predictable capacity while maintaining delivery speed and consistent screening standards.
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

        <div className="pricing-page__trust-line">
          <p>Responsible AI and privacy-conscious workflows support recruiter-led review without replacing human hiring decisions.</p>
          <a href="/trust" className="pricing-page__trust-link">See Trust &amp; Responsible AI</a>
        </div>
      </section>

    </main>
  )
}
