import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'
import '../styles/billing.css'
import '../styles/checkout.css'

const SUPPORT_EMAIL = 'hello@hireflow.dev'

export default function UpdatePaymentMethodPage() {
  usePageSeo('Update Payment Method', 'Update your billing card details securely through Paddle.')

  return (
    <main className="billing-shell">
      <section className="billing-shell__section">
        <div className="page-header">
          <div>
            <h1 className="page-title">Update Payment Method</h1>
            <p className="page-subtitle">
              Payment method updates are handled through Paddle&apos;s secure billing flow so HireFlow never collects or processes card numbers, expiry dates, or security codes.
            </p>
          </div>
          <BackButton />
        </div>

        <div className="billing-shell__form" aria-labelledby="secure-payment-update-title">
          <h2 id="secure-payment-update-title" className="billing-modal__title">Secure billing update</h2>
          <p className="billing-modal__muted">
            A self-service Paddle payment method update link is not available in this workspace yet. Please contact support and we&apos;ll send you the secure Paddle-hosted billing instructions for your account.
          </p>
          <div className="billing-shell__actions">
            <a className="hf-btn hf-btn--primary" href={`mailto:${SUPPORT_EMAIL}?subject=Payment%20method%20update%20request`}>
              Contact support
            </a>
            <a className="hf-btn hf-btn--secondary" href="/billing">
              Back to billing
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
