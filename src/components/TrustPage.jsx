import ContentDocument from './ContentDocument'

export default function TrustPage() {
  return (
    <ContentDocument title="Trust and responsible AI" eyebrow="Trust">
      <p className="content-document__paragraph"><strong>Last updated: July 11, 2026</strong></p>
      <p className="content-document__paragraph">
        HireFlow is an early-access AI-assisted recruiting workflow product. It helps teams structure resume review, compare candidate materials against role requirements, and keep recruiters and hiring managers responsible for final decisions.
      </p>

      <h2 className="content-document__heading">What HireFlow processes</h2>
      <p className="content-document__paragraph">
        Depending on how customers use the service, HireFlow may process account information, job descriptions, uploaded resumes, extracted resume text, candidate analysis results, workflow metadata, shortlists, support or contact information, and technical logs needed to operate and troubleshoot the product.
      </p>

      <h2 className="content-document__heading">How AI is used</h2>
      <p className="content-document__paragraph">
        HireFlow uses AI to support requested resume and job-description analysis workflows. AI output may include scores, summaries, strengths, gaps, skills, recent experience, missing requirements, recommendations, and reasoning based on the information provided by the customer.
      </p>
      <p className="content-document__paragraph">
        AI output is decision support only. HireFlow must not be used as the sole basis for hiring, rejection, interview, or shortlist decisions. Human review by recruiters and hiring managers is required before taking action on a candidate.
      </p>

      <h2 className="content-document__heading">Current safeguards</h2>
      <p className="content-document__paragraph">
        HireFlow is designed with safeguards appropriate for an early-access SaaS product, including authenticated app access, HTTP-only auth cookies where applicable, rate limiting, CORS allowlisting, upload validation, upload size and batch limits, async processing with persisted status, production-safe logging defaults where applicable, and support-based deletion, access, correction, and export requests.
      </p>
      <p className="content-document__paragraph">
        File scanning may be available only when optional production configuration is enabled. HireFlow does not claim that all uploads are malware scanned.
      </p>

      <h2 className="content-document__heading">Current limitations</h2>
      <p className="content-document__paragraph">
        HireFlow is early-stage software. We do not claim SOC 2 certification, ISO 27001 certification, GDPR certification, CCPA certification, EEOC certification, completed third-party audits, completed penetration tests, bias-free AI, or guaranteed AI accuracy.
      </p>
      <p className="content-document__paragraph">
        AI can make mistakes or miss context. Resume extraction quality can vary for scanned, image-only, malformed, encrypted, or incomplete files. Production posture also depends on correctly configured production infrastructure and environment variables.
      </p>

      <h2 className="content-document__heading">Customer responsibilities</h2>
      <p className="content-document__paragraph">
        Customers are responsible for having appropriate permission or another lawful basis to upload candidate data. Customers are also responsible for complying with employment, privacy, anti-discrimination, data protection, notice, consent, and recordkeeping obligations that apply to their hiring workflows.
      </p>
      <p className="content-document__paragraph">
        Recruiters and hiring managers must independently review AI-assisted outputs, candidate materials, role requirements, and any other relevant context before making hiring, rejection, interview, or shortlist decisions.
      </p>

      <h2 className="content-document__heading">Contact and related policies</h2>
      <p className="content-document__paragraph">
        Questions about HireFlow trust, privacy, responsible AI, or candidate data requests can be sent to <a className="content-document__link" href="mailto:Hello@hireflow.dev">Hello@hireflow.dev</a>.
      </p>
      <ul className="content-document__list">
        <li><a className="content-document__link" href="/privacy">Privacy Policy</a></li>
        <li><a className="content-document__link" href="/terms">Terms of Service</a></li>
        <li><a className="content-document__link" href="/ai-disclosure">AI Disclosure</a></li>
        <li><a className="content-document__link" href="/cookie-policy">Cookie Policy</a></li>
        <li><a className="content-document__link" href="/refund-policy">Refund Policy</a></li>
        <li><a className="content-document__link" href="/contact">Contact</a></li>
      </ul>
    </ContentDocument>
  )
}
