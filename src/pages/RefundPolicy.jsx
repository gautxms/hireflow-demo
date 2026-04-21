import BackButton from '../components/BackButton'

export default function RefundPolicy() {
  return (
    <div style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.25rem', lineHeight: 1.75 }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <BackButton />
        </div>
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
            <a href="mailto:hello@gfactai.com" style={{ color: 'var(--color-accent-green)' }}>hello@gfactai.com</a>.
          </p>
          <p>
            This policy complies with Paddle’s merchant and billing requirements.
          </p>
        </article>
      </main>
    </div>
  )
}
