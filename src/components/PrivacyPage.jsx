import ContentDocument from './ContentDocument'

export default function PrivacyPage() {
  return (
    <ContentDocument title="Privacy Policy" eyebrow="Legal">
      <p className="content-document__paragraph"><strong>Last updated: June 23, 2026</strong></p>
      <p className="content-document__paragraph">
        HireFlow is an early-stage recruiting workflow product for resume screening and candidate review. This Privacy Policy explains how we process information when customers use hireflow.dev and the HireFlow app.
      </p>
      <h2 className="content-document__heading">Information we process</h2>
      <p className="content-document__paragraph">Depending on how you use HireFlow, we may process account information, job descriptions, uploaded resumes, extracted resume text, candidate analysis results, workflow metadata, shortlist and recruiting decisions, support or contact information, and technical logs needed to operate, troubleshoot, and secure the service.</p>
      <h2 className="content-document__heading">How we use information</h2>
      <p className="content-document__paragraph">We use customer and candidate data to provide requested recruiting workflows, including resume and job-description matching, candidate analysis, ranking support, shortlist workflows, account management, billing, support, abuse prevention, reliability monitoring, and service improvement.</p>
      <h2 className="content-document__heading">AI-assisted processing</h2>
      <p className="content-document__paragraph">HireFlow uses AI processing providers to operate requested resume/JD analysis workflows. Candidate data is processed to provide resume matching, summaries, strengths, gaps, skills, experience signals, recommendations, and related decision-support output. Learn more in our <a className="content-document__link" href="/ai-disclosure">AI Disclosure</a>.</p>
      <h2 className="content-document__heading">Advertising and sale of personal information</h2>
      <p className="content-document__paragraph">HireFlow does not sell personal information. Resume contents, candidate names, candidate contact details, job descriptions, and AI reasoning should not be used for advertising. Product analytics should avoid recruiting content and personal candidate data.</p>
      <h2 className="content-document__heading">Service providers</h2>
      <p className="content-document__paragraph">We may use service providers for hosting, storage, email delivery, payment processing, analytics where consent applies, support tooling, and AI processing needed to operate requested workflows. These providers process information on our behalf so we can run the service.</p>
      <h2 className="content-document__heading">Customer responsibilities</h2>
      <p className="content-document__paragraph">Customers are responsible for having appropriate permission or another lawful basis to upload candidate information and use HireFlow in their hiring workflows. Customers should use HireFlow in compliance with applicable employment, privacy, anti-discrimination, and data protection obligations.</p>
      <h2 className="content-document__heading">Security and retention</h2>
      <p className="content-document__paragraph">We use reasonable technical and organizational safeguards appropriate for an early-stage SaaS product. We do not claim formal security or compliance certifications unless separately published and verified. We retain information for as long as needed to provide the service, comply with legal obligations, resolve disputes, prevent abuse, and maintain business records.</p>
      <h2 className="content-document__heading">Deletion, access, and contact requests</h2>
      <p className="content-document__paragraph">To request deletion, access, correction, or export of account or candidate information, contact us at <a className="content-document__link" href="mailto:Hello@hireflow.dev">Hello@hireflow.dev</a>. Please include enough detail for us to identify the account, workspace, job, resume, or candidate record involved. We may need to verify the requester and may retain limited records where required for security, legal, or billing reasons.</p>
      <h2 className="content-document__heading">Changes to this policy</h2>
      <p className="content-document__paragraph">We may update this policy as HireFlow prepares for launch and the product changes. Material updates will be reflected by changing the last-updated date above.</p>
    </ContentDocument>
  )
}
