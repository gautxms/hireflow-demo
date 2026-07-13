import ContentDocument from './ContentDocument'

export default function TrustPage() {
  return (
    <ContentDocument title="Trust and responsible AI" eyebrow="Trust">
      <p className="content-document__paragraph"><strong>Last updated: July 13, 2026</strong></p>
      <p className="content-document__paragraph">
        HireFlow is an early-access AI-assisted recruiting workflow product built to help teams move faster while keeping recruiters and hiring managers in control. This page summarizes the safeguards, policies, and support paths that help customers use HireFlow with confidence.
      </p>

      <h2 className="content-document__heading">Recruiter-led by design</h2>
      <p className="content-document__paragraph">
        HireFlow structures resume review, compares candidate materials against role requirements, and presents reasoning that hiring teams can inspect. AI-assisted outputs are designed to support human review, not replace recruiter judgment or make final employment decisions.
      </p>
      <p className="content-document__paragraph">
        Teams should review candidate materials, role context, and HireFlow output together before deciding who to interview, shortlist, advance, or reject.
      </p>

      <h2 className="content-document__heading">Privacy-conscious workflows</h2>
      <p className="content-document__paragraph">
        Depending on customer use, HireFlow may process account information, job descriptions, uploaded resumes, extracted resume text, candidate analysis results, workflow metadata, shortlists, support information, and technical logs needed to provide and maintain the service.
      </p>
      <p className="content-document__paragraph">
        Candidate data is used to provide requested recruiting workflows, support the product, prevent abuse, troubleshoot reliability issues, and maintain appropriate business records. Privacy and data-handling details are covered in the <a className="content-document__link" href="/privacy">Privacy Policy</a> and <a className="content-document__link" href="/terms">Terms of Service</a>.
      </p>

      <h2 className="content-document__heading">Operational safeguards</h2>
      <p className="content-document__paragraph">
        HireFlow uses safeguards appropriate for an early-access SaaS product, including authenticated app access, HTTP-only auth cookies where applicable, rate limiting, CORS allowlisting, upload validation, upload size and batch limits, async processing with persisted status, and production-safe logging defaults where applicable.
      </p>
      <p className="content-document__paragraph">
        Uploads are validated for supported file types, file size, and batch limits before processing. Operational safeguards are reviewed as part of launch readiness and ongoing maintenance.
      </p>

      <h2 className="content-document__heading">Responsible AI overview</h2>
      <p className="content-document__paragraph">
        HireFlow uses AI to support requested resume and job-description analysis workflows. AI output may be incomplete or mistaken, so it should be treated as structured decision support and reviewed by qualified people before any hiring action is taken.
      </p>
      <p className="content-document__paragraph">
        For the detailed policy language on AI outputs, limitations, and responsible customer use, review the <a className="content-document__link" href="/ai-disclosure">AI Disclosure</a>.
      </p>

      <h2 className="content-document__heading">Current scope</h2>
      <p className="content-document__paragraph">
        HireFlow is an early-access product and does not present itself as a formally audited or certified compliance platform. We avoid unsupported claims and provide clear policies for privacy, responsible AI, billing, and customer use.
      </p>
      <p className="content-document__paragraph">
        Customers remain responsible for using HireFlow in a lawful hiring process, including meeting employment, privacy, anti-discrimination, data protection, notice, consent, and recordkeeping obligations that apply to their organization and candidates.
      </p>

      <h2 className="content-document__heading">Support and related policies</h2>
      <p className="content-document__paragraph">
        Questions about HireFlow trust, privacy, responsible AI, billing, or candidate data requests can be sent to <a className="content-document__link" href="mailto:Hello@hireflow.dev">Hello@hireflow.dev</a>.
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
