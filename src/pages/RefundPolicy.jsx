import ContentDocument from '../components/ContentDocument'

export default function RefundPolicy() {
  return (
    <ContentDocument title="Refund Policy" eyebrow="Legal">
      <p className="content-document__paragraph">
        Hireflow offers eligible new accounts one 7-day free trial. Trials are not reinstated after cancellation, payment failure, pausing, or a previous subscription.
      </p>
      <p className="content-document__paragraph">
        Once a subscription converts to a paid plan, payments are non-refundable.
      </p>
      <p className="content-document__paragraph">
        You may cancel your subscription at any time to prevent future charges.
      </p>
      <p className="content-document__paragraph">
        If you believe you were charged in error, please contact us at{' '}
        <a href="mailto:Hello@hireflow.dev" className="content-document__link">Hello@hireflow.dev</a>.
      </p>
      <p className="content-document__paragraph">
        This policy complies with Paddle’s merchant and billing requirements.
      </p>
    </ContentDocument>
  )
}
