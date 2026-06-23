import ContentDocument from './ContentDocument'

export default function AiDisclosurePage() {
  return (
    <ContentDocument title="AI Disclosure" eyebrow="Trust">
      <p className="content-document__paragraph"><strong>Last updated: June 23, 2026</strong></p>
      <p className="content-document__paragraph">HireFlow uses AI-assisted analysis to compare resumes against job descriptions and help recruiting teams review candidates in a more structured way.</p>
      <h2 className="content-document__heading">What AI output may include</h2>
      <p className="content-document__paragraph">Outputs may include scores, summaries, strengths, gaps, skills, recent experience, missing requirements, recommendations, and reasoning tied to the job description and resume content provided by the customer.</p>
      <h2 className="content-document__heading">Decision support, not automated hiring</h2>
      <p className="content-document__paragraph">HireFlow output is decision support. It is not a final hiring decision, rejection decision, or replacement for recruiter and hiring-manager judgment. Customers should independently review recommendations before making hiring, rejection, interview, or shortlist decisions.</p>
      <h2 className="content-document__heading">AI limitations</h2>
      <p className="content-document__paragraph">AI can make mistakes or miss context, especially when resumes are incomplete, poorly formatted, scanned, image-only, or missing relevant details. Resume extraction quality and job description clarity can also affect the usefulness of results.</p>
      <h2 className="content-document__heading">Responsible customer use</h2>
      <p className="content-document__paragraph">Customers are responsible for using HireFlow in compliance with employment, privacy, anti-discrimination, and data protection obligations. HireFlow should not be used as the sole basis for hiring or rejection decisions.</p>
      <h2 className="content-document__heading">Related policies</h2>
      <p className="content-document__paragraph">For more detail about data handling, review our <a className="content-document__link" href="/privacy">Privacy Policy</a> and <a className="content-document__link" href="/terms">Terms of Service</a>. Questions can be sent to <a className="content-document__link" href="mailto:hello@hireflow.dev">hello@hireflow.dev</a>.</p>
    </ContentDocument>
  )
}
