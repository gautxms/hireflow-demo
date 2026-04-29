import { useEffect, useMemo, useRef, useState } from 'react'
import BackButton from './BackButton'
import { filterHelpArticles, parseHelpCenterLocation, resolveVisibleSelection, updateHelpCenterHistory } from './helpCenterState'
import { Icon } from './Icon'

const HELP_ARTICLES = {
  'getting-started': [
    {
      id: 1,
      title: 'Create your account and sign in',
      desc: 'Start with signup, login, and email verification basics',
      content: [
        'Create an account from the signup page, then verify your email before continuing to protected areas.',
        'Use Login once your account is verified. If your session expires, sign in again to continue your work.',
        'If you forget your password, use Forgot Password and complete Reset Password from the emailed link.',
      ],
    },
    {
      id: 2,
      title: 'Set up before your first upload',
      desc: 'Subscription and job description steps that unlock uploading',
      content: [
        'Resume uploads require an active or trialing subscription status in your account.',
        'Open Job Descriptions to create or select an active draft before starting analysis.',
        'Once setup is done, go to Uploader and add one file or a batch in the same session.',
      ],
    },
    {
      id: 3,
      title: 'Troubleshoot account access',
      desc: 'Common sign-in and access blockers',
      content: [
        'If a page asks you to log in, sign in again and retry the action from the same browser tab.',
        'If billing pages fail to load, confirm you are logged in before opening Subscription Management.',
        'For persistent issues, contact support with your workspace ID and a short description of the error.',
      ],
    },
  ],
  uploading: [
    {
      id: 4,
      title: 'Supported file formats and size limits',
      desc: 'Exactly what upload accepts today',
      content: [
        'HireFlow currently accepts PDF and DOCX resumes only.',
        'Each file must be 100MB or smaller.',
        'If a file type is rejected, convert it to PDF or DOCX and upload again.',
      ],
    },
    {
      id: 5,
      title: 'Bulk upload and progress tracking',
      desc: 'Upload many resumes in one run',
      content: [
        'You can drag and drop multiple resumes at once or select multiple files from your device.',
        'Large uploads run in chunks and show progress as completed chunks over total chunks.',
        'If a temporary network issue occurs, upload retries run automatically before showing an error.',
      ],
    },
    {
      id: 6,
      title: 'Parse status and error messages',
      desc: 'Understand processing states after upload',
      content: [
        'After upload, parsing status updates while HireFlow processes candidate data.',
        'A parse failure message includes a reason and recommends retrying with PDF or DOCX.',
        'When upload cannot be completed, the error panel explains the reason and next action.',
      ],
    },
  ],
  analysis: [
    {
      id: 7,
      title: 'Review candidate scores and details',
      desc: 'How to work through ranked results',
      content: [
        'Candidate results include match score, skills, experience, and upload date for each profile.',
        'Use search, skill filters, and experience range to narrow large candidate lists quickly.',
        'Sort by score, name, experience, or upload date depending on your review goal.',
      ],
    },
    {
      id: 8,
      title: 'Build and manage shortlists',
      desc: 'Create lists and add candidates for team review',
      content: [
        'Create shortlist collections, then add candidates directly from results.',
        'Review shortlist details and sort shortlist entries by rating or added date.',
        'Use shortlist notes and ratings to keep hiring manager context in one place.',
      ],
    },
    {
      id: 9,
      title: 'Tag candidates and export CSV',
      desc: 'Share actionable outputs with stakeholders',
      content: [
        'Apply tags to candidates so your team can track hiring themes and follow-up actions.',
        'Use bulk actions to select candidates and export their data as a CSV file.',
        'CSV export is useful for handoffs, reporting, and offline review workflows.',
      ],
    },
  ],
  billing: [
    {
      id: 10,
      title: 'Manage plans and subscription status',
      desc: 'View current plan and change cadence',
      content: [
        'Billing shows your current plan, status, renewal date, and next billing date.',
        'You can switch between monthly and annual plans from Subscription Management.',
        'Plan changes refresh billing details after confirmation.',
      ],
    },
    {
      id: 11,
      title: 'Invoices and download history',
      desc: 'Access billing records for accounting',
      content: [
        'Billing history lists invoice entries from recent billing cycles.',
        'Use Download PDF on available rows to save invoice documents.',
        'If no invoice appears, billing history will update after a successful billing cycle.',
      ],
    },
    {
      id: 12,
      title: 'Cancellations and refund policy',
      desc: 'What happens when you cancel or request help',
      content: [
        'Canceling a subscription keeps access active through the current billing period.',
        'Use the in-app refund policy page for official terms and support expectations.',
        'If you have a billing dispute, contact support with invoice details and workspace ID.',
      ],
    },
  ],
}

const HELP_CATEGORIES = [
  { id: 'getting-started', name: 'Getting Started', icon: 'rocket' },
  { id: 'uploading', name: 'Uploading Resumes', icon: 'file' },
  { id: 'analysis', name: 'Analysis & Results', icon: 'settings' },
  { id: 'billing', name: 'Billing & Plans', icon: 'creditCard' },
]

const HELP_FAQS = [
  {
    q: 'What file types can I upload right now?',
    a: 'Upload supports PDF and DOCX resumes. Other file types must be converted before uploading.',
  },
  {
    q: 'Is there a file size limit?',
    a: 'Yes. Each resume file must be 100MB or less.',
  },
  {
    q: 'Can I upload resumes in bulk?',
    a: 'Yes. You can upload multiple files in one session, and progress is shown while chunks upload and parse.',
  },
  {
    q: 'Can I export candidate results?',
    a: 'Yes. Results support CSV export, including bulk selection workflows.',
  },
  {
    q: 'Do shortlists exist in the app?',
    a: 'Yes. You can create shortlists, add candidates, and sort shortlist entries by rating or added date.',
  },
  {
    q: 'Where do I manage invoices and subscription changes?',
    a: 'Open Billing to view plan details, billing history, and available invoice downloads.',
  },
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
    <PublicPageLayout className="page-content">
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
              <p className="public-card-copy">Use Getting Started for login, signup, verification, and password reset troubleshooting.</p>
            </article>
            <article className="public-card">
              <h3 className="public-card-title">Upload and results questions</h3>
              <p className="public-card-copy">Review Uploading Resumes and Analysis &amp; Results for file limits, parse states, shortlist workflows, and exports.</p>
            </article>
            <article className="public-card">
              <h3 className="public-card-title">Billing and subscription support</h3>
              <p className="public-card-copy">Visit Billing &amp; Plans for invoices, plan changes, cancellation flow, and refund policy links.</p>
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
        <h2 className="public-section-title">Get unstuck faster</h2>
        <p className="public-copy center">Talk to support for issue resolution or book a walkthrough to improve your workflow.</p>
        <div className="public-button-row center">
          <a className="public-btn-primary" href="/contact">Contact support</a>
          <a className="public-btn-secondary" href="/demo">Schedule demo</a>
        </div>
      </footer>
    </PublicPageLayout>
  )
}
