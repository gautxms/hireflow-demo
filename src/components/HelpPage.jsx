import { useEffect, useMemo, useRef, useState } from 'react'
import BackButton from './BackButton'
import { filterHelpArticles, parseHelpCenterLocation, resolveVisibleSelection, updateHelpCenterHistory } from './helpCenterState'
import { Icon } from './Icon'

const HELP_ARTICLES = {
  'getting-started': [
    { id: 1, title: 'Getting Started with HireFlow', desc: 'Learn the basics of uploading resumes and analyzing candidates', content: ['Start by creating a project with a clear job title and role requirements. This gives HireFlow context for better resume matching.', 'Upload your first batch of resumes and let the parser extract experience, skills, and qualifications automatically.', 'Review the ranked candidate list and open each profile to see detailed score breakdowns, strengths, and potential concerns.'] },
    { id: 2, title: 'Creating Your First Project', desc: 'Set up a new hiring project in 5 minutes', content: ['From your dashboard, click New Project and choose a role template or start from scratch.', 'Add must-have requirements, preferred skills, and any deal-breakers so the AI can prioritize candidates accurately.', 'Invite teammates to collaborate and align on score thresholds before you begin shortlisting.'] },
    { id: 3, title: 'Understanding Candidate Scores', desc: 'How our AI scoring system works', content: ['Each candidate receives an overall score plus category scores for skills match, experience fit, and role alignment.', 'Use the score rationale panel to understand why points were added or deducted.', 'Scores are decision support, not automatic decisions. Combine them with human review for the best outcomes.'] }
  ],
  uploading: [
    { id: 4, title: 'Upload Resumes', desc: 'Accepted formats and best practices', content: ['Upload PDF resumes directly from your local device or drag-and-drop into an active project.', 'For best parsing quality, use text-based PDFs instead of scanned images when possible.', 'Tag uploads by source (job board, referral, career page) to track candidate pipeline performance later.'] },
    { id: 5, title: 'Bulk Import', desc: 'Upload multiple resumes at once', content: ['Use Bulk Import when processing large applicant batches for a single role.', 'Drop multiple files in one action and monitor import progress in the project activity feed.', 'After processing, sort by score or filter by must-have criteria to review top candidates first.'] },
    { id: 6, title: 'Resume Parsing', desc: 'How we extract candidate information', content: ['HireFlow extracts structured data like work history, education, skills, and certifications.', 'Ambiguous text is flagged for manual review so your team can quickly verify details.', 'Parser quality improves over time through feedback signals from recruiter actions.'] }
  ],
  analysis: [
    { id: 7, title: 'Scoring Dimensions', desc: 'The 20+ factors we evaluate', content: ['Scoring dimensions include experience depth, role relevance, technical alignment, and trajectory.', 'Every dimension has a configurable weight, so you can tailor results to each hiring workflow.', 'Hover over a score to see evidence snippets taken directly from the candidate resume.'] },
    { id: 8, title: 'Custom Scoring Rules', desc: 'Create scoring rules for your specific needs', content: ['Create rules that boost candidates with specific credentials or years of experience.', 'Add negative weights for disqualifying factors to reduce manual triage workload.', 'Test rule changes on existing candidate pools before applying them broadly.'] },
    { id: 9, title: 'Candidate Comparison', desc: 'Compare candidates side by side', content: ['Open two or more candidates in compare mode to review strengths across shared criteria.', 'Use normalized score bars to quickly identify where each candidate stands out.', 'Export comparison summaries for interview panel prep and stakeholder reviews.'] }
  ],
  integrations: [
    { id: 10, title: 'Slack Integration', desc: 'Get notifications in your Slack workspace', content: ['Connect Slack to receive alerts when new top-ranked candidates are available.', 'Route notifications to team channels by role or department for faster response.', 'Include deep links in alerts so reviewers can jump straight into candidate profiles.'] },
    { id: 11, title: 'Email Integration', desc: 'Forward resumes directly to HireFlow', content: ['Set up your project inbox to forward resumes directly from email into HireFlow.', 'Use role-specific forwarding aliases to keep candidate pipelines organized.', 'Automatic duplicate checks prevent candidates from being added multiple times.'] },
    { id: 12, title: 'API Documentation', desc: 'Build custom integrations with our API', content: ['Use API endpoints to push candidate data into HireFlow from external systems.', 'Webhooks notify your ATS or CRM when scores, status, or shortlist decisions change.', 'Generate scoped API keys per integration and rotate them regularly for security.'] }
  ],
  billing: [
    { id: 13, title: 'Plans and Pricing', desc: 'Understand our billing structure', content: ['Choose a plan based on monthly resume volume, team size, and integration requirements.', 'You can upgrade at any time, and plan changes take effect immediately for new usage.', 'Annual billing options provide discounts for teams with predictable hiring volume.'] },
    { id: 14, title: 'Invoices and Receipts', desc: 'Access your billing history', content: ['All invoices are available in the Billing tab with download links for accounting records.', 'Billing admins can add purchase order references and tax details where required.', 'Receipts are generated automatically after each successful payment.'] },
    { id: 15, title: 'Refund Policy', desc: 'Learn about our refund terms', content: ['Refund eligibility depends on plan type, billing cycle, and recent usage levels.', 'For any billing issue, contact support with your workspace ID and invoice number.', 'Enterprise agreements may include custom terms defined in your service contract.'] }
  ]
}

const HELP_CATEGORIES = [
  { id: 'getting-started', name: 'Getting Started', icon: 'rocket' },
  { id: 'uploading', name: 'Uploading Resumes', icon: 'file' },
  { id: 'analysis', name: 'Analysis & Scoring', icon: 'settings' },
  { id: 'integrations', name: 'Integrations', icon: 'link' },
  { id: 'billing', name: 'Billing & Plans', icon: 'creditCard' }
]

const HELP_FAQS = [
  { q: 'How many resumes can I upload?', a: 'Depends on your plan. Starter: 50/month, Pro: 500/month, Enterprise: Unlimited' },
  { q: 'What file formats are supported?', a: 'We support PDF resumes. Attach as email or upload directly on the platform' },
  { q: 'How accurate is the AI scoring?', a: 'Our system has 94% accuracy. Results are constantly improving as we learn from your feedback' },
  { q: 'Can I export candidate data?', a: 'Yes, you can export as CSV or integrate with your ATS via our API' },
  { q: 'What happens to my data after I delete it?', a: 'Your data is permanently deleted within 30 days. We follow GDPR and CCPA compliance' },
  { q: 'Do you offer custom integrations?', a: 'Yes, contact our sales team for enterprise custom integrations' }
]

export default function HelpPage({ onBack }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('getting-started')
  const [selectedArticleId, setSelectedArticleId] = useState(null)
  const articleTriggerRefs = useRef({})

  useEffect(() => {
    const syncStateFromUrl = () => {
      const next = parseHelpCenterLocation(HELP_ARTICLES, 'getting-started', window.location.href)
      setActiveCategory(next.activeCategory)
      setSelectedArticleId(next.selectedArticleId)
    }

    syncStateFromUrl()
    window.addEventListener('popstate', syncStateFromUrl)
    return () => window.removeEventListener('popstate', syncStateFromUrl)
  }, [])

  const filteredArticles = useMemo(() => filterHelpArticles(HELP_ARTICLES[activeCategory], searchQuery), [activeCategory, searchQuery])
  const visibleSelectedArticleId = resolveVisibleSelection(selectedArticleId, filteredArticles)

  useEffect(() => {
    if (!visibleSelectedArticleId) {
      return
    }

    const triggerElement = articleTriggerRefs.current[visibleSelectedArticleId]
    if (!triggerElement) {
      return
    }

    const navOffset = 96
    const triggerTop = triggerElement.getBoundingClientRect().top + window.scrollY - navOffset
    window.scrollTo({ top: Math.max(triggerTop, 0), behavior: 'smooth' })
    triggerElement.focus({ preventScroll: true })
  }, [visibleSelectedArticleId])

  const openArticle = (article) => {
    const nextId = visibleSelectedArticleId === article.id ? null : article.id
    setSelectedArticleId(nextId)
    updateHelpCenterHistory(nextId, window.location.href)
  }

  return (
    <div className="public-page page-content">
      <div className="public-page-hero">
        <div className="public-copy center public-mb-md"><BackButton onBack={onBack} /></div>
        <h1 className="public-page-title">Help Center</h1>
        <p className="public-page-subtitle">Find product documentation, troubleshooting steps, and billing support resources.</p>
      </div>

      <section className="public-section help-search-wrap">
        <input type="text" className="public-form-search" placeholder="Search help articles..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </section>

      <section className="public-section public-page-main">
        <div className="help-layout">
          <aside className="help-sidebar">
            {HELP_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id)
                  setSelectedArticleId(null)
                  updateHelpCenterHistory(null, window.location.href, { replace: true })
                }}
                aria-pressed={activeCategory === cat.id}
                className={`help-category-btn ${activeCategory === cat.id ? 'active' : ''}`}
              >
                <span className="help-category-icon"><Icon name={cat.icon} size="sm" tone="current" /></span>{cat.name}
              </button>
            ))}
          </aside>

          <div>
            <h2 className="public-section-title">{HELP_CATEGORIES.find((c) => c.id === activeCategory)?.name}</h2>
            <div className="public-faq-grid">
              {filteredArticles.map((article) => (
                <div key={article.id} className={`help-article-item ${visibleSelectedArticleId === article.id ? 'is-expanded' : ''}`}>
                  <button
                    id={`help-article-trigger-${article.id}`}
                    ref={(element) => {
                      if (element) {
                        articleTriggerRefs.current[article.id] = element
                      }
                    }}
                    onClick={() => openArticle(article)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openArticle(article)
                      }
                    }}
                    aria-expanded={visibleSelectedArticleId === article.id}
                    aria-controls={`help-article-${article.id}`}
                    className="public-card help-article-trigger"
                  >
                    <div>
                      <h3 className="public-card-title">{article.title}</h3>
                      <p className="public-card-copy">{article.desc}</p>
                    </div>
                    <div className="contact-accent-title">→</div>
                  </button>

                  {visibleSelectedArticleId === article.id && (
                    <div
                      id={`help-article-${article.id}`}
                      role="region"
                      aria-labelledby={`help-article-trigger-${article.id}`}
                      className="public-card help-article-panel"
                    >
                      <h3 className="public-card-title">{article.title}</h3>
                      <div className="public-faq-grid">
                        {article.content.map((paragraph, index) => <p key={index} className="public-card-copy">{paragraph}</p>)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="public-section public-section-alt">
        <div className="public-page-main">
          <h2 className="public-section-title center">Support quick links</h2>
          <div className="public-feature-grid public-max-800">
            <article className="public-card">
              <h3 className="public-card-title">Account and access issues</h3>
              <p className="public-card-copy">Use getting-started articles for login, onboarding, and workspace setup troubleshooting.</p>
            </article>
            <article className="public-card">
              <h3 className="public-card-title">Scoring and analysis questions</h3>
              <p className="public-card-copy">Review Analysis &amp; Scoring docs to understand scoring dimensions, rule configuration, and comparison tools.</p>
            </article>
            <article className="public-card">
              <h3 className="public-card-title">Billing and subscription support</h3>
              <p className="public-card-copy">Visit Billing &amp; Plans for invoices, receipts, refund terms, and plan-change guidance.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="public-section">
        <div className="public-page-main">
          <h2 className="public-section-title center">Frequently Asked Questions</h2>
          <div className="public-faq-grid public-max-800">
            {HELP_FAQS.map((faq, i) => (
              <article key={i} className="public-card">
                <h4 className="public-card-title contact-accent-title">Q: {faq.q}</h4>
                <p className="public-card-copy">A: {faq.a}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="public-cta-footer">
        <h2 className="public-section-title">Need more help?</h2>
        <p className="public-copy center">If the docs do not resolve your issue, contact support with your workspace ID and issue details.</p>
        <div className="public-button-row center">
          <button className="btn-primary">Contact Support</button>
          <button className="btn-ghost">Open ticket guide</button>
        </div>
      </footer>
    </div>
  )
}
