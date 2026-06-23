import ContentDocument from './ContentDocument'

export default function TermsPage() {
  return (
    <ContentDocument title="Terms of Service" eyebrow="Legal">
      <p className="content-document__paragraph"><strong>Last updated: June 23, 2026</strong></p>
      <p className="content-document__paragraph">By accessing HireFlow, you agree to use the service for lawful hiring operations and internal recruiting workflows only.</p>
      <h2 className="content-document__heading">Acceptable use</h2>
      <p className="content-document__paragraph">You are responsible for ensuring uploaded content is lawful and that you have permission or another lawful basis to process candidate information.</p>
      <h2 className="content-document__heading">AI-assisted output</h2>
      <p className="content-document__paragraph">HireFlow output is decision support, not a final hiring decision. Recruiters and hiring managers should independently review recommendations before making candidate decisions.</p>
      <h2 className="content-document__heading">Service availability</h2>
      <p className="content-document__paragraph">HireFlow may update, improve, or maintain the platform over time. We strive for reliable access but do not guarantee uninterrupted availability.</p>
      <h2 className="content-document__heading">Contact</h2>
      <p className="content-document__paragraph">Questions about these terms can be sent to <a className="content-document__link" href="mailto:hello@hireflow.dev">hello@hireflow.dev</a>.</p>
    </ContentDocument>
  )
}
