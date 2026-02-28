import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from '../components/PublicFooter'

export default function RefundPolicy() {
  usePageSeo('Refund Policy – Hireflow', 'Read Hireflow’s refund policy, including trial terms, non-refundable payments after conversion, and billing support contact information.')

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.25rem', lineHeight: 1.75 }}>
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
            <a href="mailto:hello@gfactai.com" style={{ color: 'var(--accent)' }}>hello@gfactai.com</a>.
          </p>
          <p>
            This policy complies with Paddle’s merchant and billing requirements.
          </p>
        </article>
      </main>
      <PublicFooter />
    </div>
  )
}
