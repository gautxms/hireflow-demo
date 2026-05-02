import './accountCards.css'

export default function BillingCard() {
  return (
    <div className="hf-account-card">
      <h2 className="hf-account-card__title">
        <span className="hf-account-card__icon">💳</span>
        Billing
      </h2>

      <p className="hf-billing-card__description">
        Manage your billing information, view invoices, and update payment methods.
      </p>

      <button
        onClick={() => {
          window.location.href = '/billing'
        }}
        className="hf-billing-card__button hf-billing-card__button--primary"
      >
        View Billing Details
      </button>

      <button
        onClick={() => {
          window.location.href = '/account/payment-method'
        }}
        className="hf-billing-card__button hf-billing-card__button--secondary"
      >
        Update Payment Method
      </button>
    </div>
  )
}
