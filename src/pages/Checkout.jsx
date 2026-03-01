import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from '../components/PublicFooter'

const PLAN_DETAILS = {
  monthly: {
    label: 'Monthly Plan',
    summary: 'You selected the monthly subscription.',
  },
  annual: {
    label: 'Annual Plan',
    summary: 'You selected the annual subscription.',
  },
}

function getPlanFromQuery() {
  const params = new URLSearchParams(window.location.search)
  const plan = params.get('plan')
  return plan === 'monthly' || plan === 'annual' ? plan : 'monthly'
}

export default function Checkout() {
  const selectedPlan = getPlanFromQuery()
  const plan = PLAN_DETAILS[selectedPlan]

  usePageSeo('HireFlow Checkout', `Checkout setup for the ${plan.label.toLowerCase()}.`)

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)' }}>
      <section style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1rem 2rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.3rem', marginBottom: '0.75rem' }}>Checkout</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          {plan.summary} Payment processing will be enabled in a later update.
        </p>

        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: '14px',
            background: 'var(--card)',
            padding: '1.5rem',
            display: 'grid',
            gap: '0.75rem',
          }}
        >
          <p style={{ margin: 0, color: 'var(--muted)' }}>Selected plan</p>
          <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>{plan.label}</p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>Query param: plan={selectedPlan}</p>
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}
