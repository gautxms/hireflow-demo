import BackButton from '../components/BackButton'

export default function RefundPolicy() {
  return (
    <div className="policy-page">
      <main className="policy-page__main">
        <div className="policy-page__back-button-wrap">
          <BackButton />
        </div>
        <article aria-label="Refund Policy">
          <h1 className="policy-page__title">Refund Policy</h1>
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
            <a href="mailto:hello@gfactai.com" className="policy-page__link">hello@gfactai.com</a>.
          </p>
          <p>
            This policy complies with Paddle’s merchant and billing requirements.
          </p>
        </article>
      </main>
    </div>
  )
}
