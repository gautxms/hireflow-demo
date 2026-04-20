import usePageSeo from '../hooks/usePageSeo'
import '../styles/billing.css'
import '../styles/checkout.css'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

export default function BillingCancel() {
  usePageSeo('Billing Canceled', 'Your HireFlow checkout was canceled before payment.')

  return (
    <main className="billing-shell billing-shell--centered route-state">
      <section className="billing-shell__card route-state-card route-state-card--verified">
        <h1 className="billing-shell__title">Checkout canceled</h1>
        <p className="billing-shell__subtitle route-state-card__message">
          No problem — your card was not charged. You can start again whenever you're ready.
        </p>
        <div className="billing-shell__actions">
          <button type="button" onClick={() => navigate('/pricing')} className="hf-btn hf-btn--secondary">
            ← Back to Pricing
          </button>
          <button type="button" onClick={() => navigate('/')} className="hf-btn hf-btn--primary">
            Return Home
          </button>
        </div>
      </section>
    </main>
  )
}
