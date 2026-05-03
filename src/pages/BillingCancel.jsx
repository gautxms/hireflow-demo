import usePageSeo from '../hooks/usePageSeo'
import '../styles/billing.css'
import '../styles/checkout.css'
import BillingStatusLayout from '../components/BillingStatusLayout'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

export default function BillingCancel() {
  usePageSeo('Billing Canceled', 'Your HireFlow checkout was canceled before payment.')

  return (
    <BillingStatusLayout
      status="warning"
      title="Checkout canceled"
      subtitle="No problem — your card was not charged. You can start again whenever you're ready."
      actions={(
        <>
          <button type="button" onClick={() => navigate('/pricing')} className="hf-btn hf-btn--secondary">Back to Pricing</button>
          <button type="button" onClick={() => navigate('/')} className="hf-btn hf-btn--primary">Return Home</button>
        </>
      )}
    />
  )
}
