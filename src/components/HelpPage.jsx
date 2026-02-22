import { useState } from 'react'

export default function HelpPage({ onBack }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('getting-started')

  const articles = {
    'getting-started': [
      { id: 1, title: 'Getting Started with HireFlow', desc: 'Learn the basics of uploading resumes and analyzing candidates' },
      { id: 2, title: 'Creating Your First Project', desc: 'Set up a new hiring project in 5 minutes' },
      { id: 3, title: 'Understanding Parsed Candidate Data', desc: 'What information is extracted from each resume today' }
    ],
    'uploading': [
      { id: 4, title: 'Upload Resumes', desc: 'Accepted formats and best practices' },
      { id: 5, title: 'Bulk Import', desc: 'Upload multiple resumes at once' },
      { id: 6, title: 'Resume Parsing', desc: 'How we extract candidate information' }
    ],
    'analysis': [
      { id: 7, title: 'Review Parsed Fields', desc: 'Inspect extracted name, skills, and experience data' },
      { id: 8, title: 'Use Results for Shortlisting', desc: 'How teams are using parsed data in beta workflows' },
      { id: 9, title: 'Scoring Roadmap', desc: 'What is planned next for scoring in HireFlow' }
    ],
    'integrations': [
      { id: 10, title: 'ATS Integration Roadmap', desc: 'Status of ATS integrations in beta' },
      { id: 11, title: 'Email Workflow', desc: 'Current email-based support and onboarding flow' },
      { id: 12, title: 'API Availability', desc: 'API access is not available in the MVP beta yet' }
    ],
    'billing': [
      { id: 13, title: 'Beta Plan', desc: 'What is included in the current starter beta' },
      { id: 14, title: 'Early Access Availability', desc: 'How to request beta access' },
      { id: 15, title: 'Future Pricing', desc: 'How we will share pricing updates after beta' }
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
    { q: 'How many resumes can I upload?', a: 'In the current beta, limits are set per team during onboarding. Contact us for your cap.' },
    { q: 'What file formats are supported?', a: 'We support PDF resumes. Attach as email or upload directly on the platform' },
    { q: 'Do you provide candidate scoring?', a: 'Not yet. The MVP currently focuses on resume upload and data extraction. Scoring is coming soon.' },
    { q: 'Can I export candidate data?', a: 'Export options are limited in beta. Reach out and we can help with manual exports for now.' },
    { q: 'What happens to my data after I delete it?', a: 'Your data is permanently deleted within 30 days. We follow GDPR and CCPA compliance' },
    { q: 'Do you offer custom integrations?', a: 'Integrations are handled case-by-case in beta. ATS integration is on the roadmap.' }
  ]

  const filteredArticles = articles[activeCategory].filter(article =>
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.desc.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '3rem 2rem', textAlign: 'center' }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--accent)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            position: 'absolute',
            top: '2rem',
            left: '2rem'
          }}
        >
          ← Back
        </button>

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
              onClick={() => setActiveCategory(cat.id)}
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
              <div
                key={article.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto'
                }}
              >
                <div>
                  <h3 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{article.title}</h3>
                  <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{article.desc}</p>
                </div>
                <div style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>→</div>
              </div>
            ))}
          </div>
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
