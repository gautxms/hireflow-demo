import { useState } from 'react'
import BackButton from './BackButton'

export default function HelpPage({ onBack }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('getting-started')
  const [selectedArticle, setSelectedArticle] = useState(null)

  const articles = {
    'getting-started': [
      {
        id: 1,
        title: 'Getting Started with HireFlow',
        desc: 'Learn the basics of uploading resumes and analyzing candidates',
        content: [
          'Start by creating a project with a clear job title and role requirements. This gives HireFlow context for better resume matching.',
          'Upload your first batch of resumes and let the parser extract experience, skills, and qualifications automatically.',
          'Review the ranked candidate list and open each profile to see detailed score breakdowns, strengths, and potential concerns.'
        ]
      },
      {
        id: 2,
        title: 'Creating Your First Project',
        desc: 'Set up a new hiring project in 5 minutes',
        content: [
          'From your dashboard, click New Project and choose a role template or start from scratch.',
          'Add must-have requirements, preferred skills, and any deal-breakers so the AI can prioritize candidates accurately.',
          'Invite teammates to collaborate and align on score thresholds before you begin shortlisting.'
        ]
      },
      {
        id: 3,
        title: 'Understanding Candidate Scores',
        desc: 'How our AI scoring system works',
        content: [
          'Each candidate receives an overall score plus category scores for skills match, experience fit, and role alignment.',
          'Use the score rationale panel to understand why points were added or deducted.',
          'Scores are decision support, not automatic decisions. Combine them with human review for the best outcomes.'
        ]
      }
    ],
    'uploading': [
      {
        id: 4,
        title: 'Upload Resumes',
        desc: 'Accepted formats and best practices',
        content: [
          'Upload PDF resumes directly from your local device or drag-and-drop into an active project.',
          'For best parsing quality, use text-based PDFs instead of scanned images when possible.',
          'Tag uploads by source (job board, referral, career page) to track candidate pipeline performance later.'
        ]
      },
      {
        id: 5,
        title: 'Bulk Import',
        desc: 'Upload multiple resumes at once',
        content: [
          'Use Bulk Import when processing large applicant batches for a single role.',
          'Drop multiple files in one action and monitor import progress in the project activity feed.',
          'After processing, sort by score or filter by must-have criteria to review top candidates first.'
        ]
      },
      {
        id: 6,
        title: 'Resume Parsing',
        desc: 'How we extract candidate information',
        content: [
          'HireFlow extracts structured data like work history, education, skills, and certifications.',
          'Ambiguous text is flagged for manual review so your team can quickly verify details.',
          'Parser quality improves over time through feedback signals from recruiter actions.'
        ]
      }
    ],
    'analysis': [
      {
        id: 7,
        title: 'Scoring Dimensions',
        desc: 'The 20+ factors we evaluate',
        content: [
          'Scoring dimensions include experience depth, role relevance, technical alignment, and trajectory.',
          'Every dimension has a configurable weight, so you can tailor results to each hiring workflow.',
          'Hover over a score to see evidence snippets taken directly from the candidate resume.'
        ]
      },
      {
        id: 8,
        title: 'Custom Scoring Rules',
        desc: 'Create scoring rules for your specific needs',
        content: [
          'Create rules that boost candidates with specific credentials or years of experience.',
          'Add negative weights for disqualifying factors to reduce manual triage workload.',
          'Test rule changes on existing candidate pools before applying them broadly.'
        ]
      },
      {
        id: 9,
        title: 'Candidate Comparison',
        desc: 'Compare candidates side by side',
        content: [
          'Open two or more candidates in compare mode to review strengths across shared criteria.',
          'Use normalized score bars to quickly identify where each candidate stands out.',
          'Export comparison summaries for interview panel prep and stakeholder reviews.'
        ]
      }
    ],
    'integrations': [
      {
        id: 10,
        title: 'Slack Integration',
        desc: 'Get notifications in your Slack workspace',
        content: [
          'Connect Slack to receive alerts when new top-ranked candidates are available.',
          'Route notifications to team channels by role or department for faster response.',
          'Include deep links in alerts so reviewers can jump straight into candidate profiles.'
        ]
      },
      {
        id: 11,
        title: 'Email Integration',
        desc: 'Forward resumes directly to HireFlow',
        content: [
          'Set up your project inbox to forward resumes directly from email into HireFlow.',
          'Use role-specific forwarding aliases to keep candidate pipelines organized.',
          'Automatic duplicate checks prevent candidates from being added multiple times.'
        ]
      },
      {
        id: 12,
        title: 'API Documentation',
        desc: 'Build custom integrations with our API',
        content: [
          'Use API endpoints to push candidate data into HireFlow from external systems.',
          'Webhooks notify your ATS or CRM when scores, status, or shortlist decisions change.',
          'Generate scoped API keys per integration and rotate them regularly for security.'
        ]
      }
    ],
    'billing': [
      {
        id: 13,
        title: 'Plans and Pricing',
        desc: 'Understand our billing structure',
        content: [
          'Choose a plan based on monthly resume volume, team size, and integration requirements.',
          'You can upgrade at any time, and plan changes take effect immediately for new usage.',
          'Annual billing options provide discounts for teams with predictable hiring volume.'
        ]
      },
      {
        id: 14,
        title: 'Invoices and Receipts',
        desc: 'Access your billing history',
        content: [
          'All invoices are available in the Billing tab with download links for accounting records.',
          'Billing admins can add purchase order references and tax details where required.',
          'Receipts are generated automatically after each successful payment.'
        ]
      },
      {
        id: 15,
        title: 'Refund Policy',
        desc: 'Learn about our refund terms',
        content: [
          'Refund eligibility depends on plan type, billing cycle, and recent usage levels.',
          'For any billing issue, contact support with your workspace ID and invoice number.',
          'Enterprise agreements may include custom terms defined in your service contract.'
        ]
      }
    ]
  }

  const categories = [
    { id: 'getting-started', name: 'Getting Started', icon: '🚀' },
    { id: 'uploading', name: 'Uploading Resumes', icon: '📄' },
    { id: 'analysis', name: 'Analysis & Scoring', icon: '⚙️' },
    { id: 'integrations', name: 'Integrations', icon: '🔗' },
    { id: 'billing', name: 'Billing & Plans', icon: '💳' }
  ]

  const faqs = [
    { q: 'How many resumes can I upload?', a: 'Depends on your plan. Starter: 50/month, Pro: 500/month, Enterprise: Unlimited' },
    { q: 'What file formats are supported?', a: 'We support PDF resumes. Attach as email or upload directly on the platform' },
    { q: 'How accurate is the AI scoring?', a: 'Our system has 94% accuracy. Results are constantly improving as we learn from your feedback' },
    { q: 'Can I export candidate data?', a: 'Yes, you can export as CSV or integrate with your ATS via our API' },
    { q: 'What happens to my data after I delete it?', a: 'Your data is permanently deleted within 30 days. We follow GDPR and CCPA compliance' },
    { q: 'Do you offer custom integrations?', a: 'Yes, contact our sales team for enterprise custom integrations' }
  ]

  const filteredArticles = articles[activeCategory].filter(article =>
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.desc.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const openArticle = (article) => {
    setSelectedArticle(article)
  }

  return (
    <div className="page-content" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '3rem 2rem', textAlign: 'center' }}>
        <div style={{ marginBottom: '1rem' }}>
          <BackButton onBack={onBack} />
        </div>

        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Help Center
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto' }}>
          Find answers and learn how to get the most out of HireFlow
        </p>
      </div>

      {/* Search */}
      <div style={{ padding: '2rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          placeholder="Search help articles..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            maxWidth: '600px',
            padding: '0.75rem 1rem',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontSize: '1rem'
          }}
        />
      </div>

      {/* Categories & Articles */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '3rem 2rem', display: 'grid', gridTemplateColumns: '250px 1fr', gap: '3rem' }}>
        {/* Sidebar */}
        <div style={{ borderRight: '1px solid var(--border)', paddingRight: '2rem' }}>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id)
                setSelectedArticle(null)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: activeCategory === cat.id ? 'rgba(232,255,90,0.1)' : 'transparent',
                border: activeCategory === cat.id ? '1px solid var(--accent)' : '1px solid transparent',
                color: activeCategory === cat.id ? 'var(--accent)' : 'var(--muted)',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.9rem',
                transition: 'all 0.2s'
              }}
            >
              <span style={{ marginRight: '0.5rem' }}>{cat.icon}</span>
              {cat.name}
            </button>
          ))}
        </div>

        {/* Articles */}
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>
            {categories.find(c => c.id === activeCategory)?.name}
          </h2>

          <div style={{ display: 'grid', gap: '1rem', marginBottom: '3rem' }}>
            {filteredArticles.map(article => (
              <div key={article.id} style={{ display: 'grid', gap: '1rem' }}>
                <button
                  onClick={() => openArticle(article)}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    width: '100%',
                    textAlign: 'left',
                    color: 'var(--text)'
                  }}
                >
                  <div>
                    <h3 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{article.title}</h3>
                    <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{article.desc}</p>
                  </div>
                  <div style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>→</div>
                </button>

                {selectedArticle?.id === article.id && (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '2rem' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>
                      {selectedArticle.title}
                    </h3>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      {selectedArticle.content.map((paragraph, index) => (
                        <p key={index} style={{ color: 'var(--muted)', lineHeight: '1.7', margin: 0 }}>
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {selectedArticle && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '2rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>
                {selectedArticle.title}
              </h3>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {selectedArticle.content.map((paragraph, index) => (
                  <p key={index} style={{ color: 'var(--muted)', lineHeight: '1.7', margin: 0 }}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FAQ Section */}
      <div style={{ background: 'var(--ink-2)', padding: '3rem 2rem' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
            Frequently Asked Questions
          </h2>

          <div style={{ display: 'grid', gap: '1.5rem', maxWidth: '800px', margin: '0 auto' }}>
            {faqs.map((faq, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1.5rem' }}>
                <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', color: 'var(--accent)' }}>
                  Q: {faq.q}
                </h4>
                <p style={{ color: 'var(--muted)', lineHeight: '1.6' }}>
                  A: {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contact Support */}
      <div style={{ padding: '3rem 2rem', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Can't find what you're looking for?
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>
          Our support team is here to help
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button style={{
            background: 'var(--accent)',
            color: 'var(--ink)',
            border: 'none',
            padding: '0.75rem 2rem',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}>
            Contact Support
          </button>
          <button style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
            padding: '0.75rem 2rem',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}>
            Schedule a Call
          </button>
        </div>
      </div>
    </div>
  )
}
