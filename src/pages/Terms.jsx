import { useEffect, useMemo, useState } from 'react'
import './Terms.css'

const sections = [
  {
    id: 'acceptance-of-terms',
    title: '1. Acceptance of Terms',
    content: [
      'By accessing or using HireFlow, you agree to be bound by these Terms and Conditions and all applicable laws and regulations. If you do not agree with any part of these Terms, you must discontinue use of the Service immediately.',
      'These Terms apply to all visitors, users, and others who access or use the Service on behalf of themselves or an organization.'
    ]
  },
  {
    id: 'service-description',
    title: '2. Service Description',
    content: [
      'HireFlow provides software tools that support candidate screening, ranking, and hiring workflow management. Features may include resume analysis, scoring, reporting, and integrations with third-party systems.',
      'We may modify, suspend, or discontinue parts of the Service at any time, with or without notice, in order to maintain, improve, or secure the platform.'
    ]
  },
  {
    id: 'account-registration',
    title: '3. Account Registration and Security',
    content: [
      'You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.',
      'You must promptly notify HireFlow of any unauthorized use of your account or any other breach of security. HireFlow is not liable for losses caused by unauthorized account use resulting from your failure to safeguard credentials.'
    ]
  },
  {
    id: 'acceptable-use',
    title: '4. Acceptable Use',
    content: [
      'You agree not to use the Service for any unlawful purpose or in any way that could damage, disable, overburden, or impair HireFlow or interfere with another party’s use of the Service.',
      'You may not attempt to gain unauthorized access to systems, data, or networks connected to the Service, nor reverse engineer or copy core platform functionality except as expressly permitted by law.'
    ]
  },
  {
    id: 'customer-data',
    title: '5. Customer Data and Privacy',
    content: [
      'You retain ownership of data you submit to HireFlow, including candidate and job-related information. You grant HireFlow a limited license to process this data solely to provide and improve the Service.',
      'Your use of the Service is also governed by our Privacy Policy. Please review our Privacy Policy at /privacy for details on collection, processing, and protection of personal data.'
    ]
  },
  {
    id: 'intellectual-property',
    title: '6. Intellectual Property',
    content: [
      'All right, title, and interest in and to the Service, including software, design, trademarks, and content provided by HireFlow, are owned by HireFlow Inc. and its licensors.',
      'Except for the limited rights expressly granted in these Terms, no rights are transferred to you by implication, estoppel, or otherwise.'
    ]
  },
  {
    id: 'fees-and-payments',
    title: '7. Fees and Payments',
    content: [
      'Certain features of the Service may require payment. You agree to pay all fees in accordance with your selected plan and applicable billing terms.',
      'Failure to pay fees when due may result in suspension or termination of access to paid features. Fees are non-refundable except as required by applicable law or expressly stated in a written agreement.'
    ]
  },
  {
    id: 'disclaimers',
    title: '8. Disclaimers',
    content: [
      'The Service is provided on an “as is” and “as available” basis. To the fullest extent permitted by law, HireFlow disclaims all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement.',
      'HireFlow does not warrant that the Service will be uninterrupted, error-free, or completely secure, or that AI-generated outputs will be accurate for every hiring context.'
    ]
  },
  {
    id: 'limitation-of-liability',
    title: '9. Limitation of Liability',
    content: [
      'To the maximum extent permitted by law, HireFlow Inc. and its affiliates, officers, employees, and licensors shall not be liable for indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or goodwill.',
      'In no event shall HireFlow’s aggregate liability arising out of or related to these Terms exceed the amounts paid by you to HireFlow for the Service in the twelve (12) months preceding the event giving rise to the claim.'
    ]
  },
  {
    id: 'termination',
    title: '10. Termination',
    content: [
      'You may stop using the Service at any time. HireFlow may suspend or terminate access immediately if you breach these Terms or if required for security, legal, or operational reasons.',
      'Upon termination, provisions that by their nature should survive termination will survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.'
    ]
  },
  {
    id: 'governing-law',
    title: '11. Governing Law and Contact',
    content: [
      'These Terms are governed by and construed in accordance with the laws of the State of Delaware, without regard to conflict of law principles.',
      'If you have questions about these Terms, please contact HireFlow Inc. at legal@hireflow.ai.'
    ]
  }
]

export default function Terms() {
  const [activeSection, setActiveSection] = useState(sections[0].id)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

        if (visible.length > 0) {
          setActiveSection(visible[0].target.id)
        }
      },
      {
        rootMargin: '-25% 0px -60% 0px',
        threshold: [0.2, 0.4, 0.6]
      }
    )

    sections.forEach((section) => {
      const element = document.getElementById(section.id)
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [])

  const sidebarLinks = useMemo(() => sections.map((section) => {
    const isActive = activeSection === section.id

    return (
      <a
        key={section.id}
        href={`#${section.id}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-current={isActive ? 'true' : undefined}
        style={{
          color: isActive ? 'var(--accent)' : 'var(--text)',
          fontWeight: isActive ? 700 : 500,
          textDecoration: 'none',
          padding: '0.4rem 0.5rem',
          borderRadius: 6,
          background: isActive ? 'rgba(232,255,90,0.08)' : 'transparent'
        }}
      >
        {section.title}
      </a>
    )
  }), [activeSection])

  return (
    <main style={{ background: 'var(--ink)', minHeight: '100vh', color: 'var(--text)' }}>
      <div className="terms-layout">
        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="terms-sidebar"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="terms-hamburger"
          style={{
            display: 'none',
            background: '#1a1a1a',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.65rem 0.8rem',
            marginBottom: '1rem'
          }}
        >
          ☰ Sections
        </button>

        <aside
          id="terms-sidebar"
          className={`terms-sidebar ${mobileMenuOpen ? 'open' : ''}`}
          style={{
            width: 280,
            minWidth: 240,
            background: '#1a1a1a',
            borderRight: '1px solid var(--border)',
            padding: '1rem',
            borderRadius: 10,
            position: 'sticky',
            top: 16,
            alignSelf: 'flex-start',
            maxHeight: 'calc(100vh - 2rem)',
            overflowY: 'auto'
          }}
        >
          <nav aria-label="Terms section navigation" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {sidebarLinks}
          </nav>
        </aside>

        <article style={{ flex: 1, maxWidth: 900, margin: '0 auto' }}>
          <h1 style={{ color: 'var(--accent)', fontWeight: 800, marginBottom: '0.5rem' }}>Terms &amp; Conditions</h1>
          <p style={{ color: 'var(--muted)', marginBottom: '1.75rem' }}>Last Updated: February 27, 2026</p>

          {sections.map((section) => (
            <section key={section.id} id={section.id} style={{ marginBottom: '1.8rem', scrollMarginTop: 24 }}>
              <h2 style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: '0.7rem' }}>{section.title}</h2>
              {section.content.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} style={{ marginBottom: '0.8rem' }}>
                  {paragraph.includes('/privacy') ? (
                    <>
                      {paragraph.split('/privacy')[0]}
                      <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>/privacy</a>
                      {paragraph.split('/privacy')[1]}
                    </>
                  ) : paragraph}
                </p>
              ))}
            </section>
          ))}
        </article>
      </div>
    </main>
  )
}
