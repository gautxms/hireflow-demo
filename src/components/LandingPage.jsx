import { useEffect, useState } from 'react'
import '../globals.css'
import StructuredData from './StructuredData'

export default function LandingPage({ onStartDemo, ctaLabel = 'Try Free Demo' }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Hireflow',
        url: 'https://hireflow.dev',
        applicationCategory: 'Recruiting/Hiring Software',
        description: 'Hireflow automates resume screening, ranks candidates, and helps teams hire faster with AI-powered recruiting workflows.',
      },
      {
        '@type': 'Organization',
        name: 'Hireflow',
        url: 'https://hireflow.dev',
        description: 'Hireflow builds AI recruiting software for modern hiring teams.',
      }
    ]
  }

  useEffect(() => {
    // Smooth scroll and interactive effects
    const anchors = document.querySelectorAll('a[href^="#"]')
    const clickHandlers = []

    anchors.forEach(anchor => {
      const handler = function (e) {
        e.preventDefault()
        const target = document.querySelector(this.getAttribute('href'))
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      }
      clickHandlers.push({ anchor, handler })
      anchor.addEventListener('click', handler)
    })

    return () => {
      clickHandlers.forEach(({ anchor, handler }) => {
        anchor.removeEventListener('click', handler)
      })
    }
  }, [])

  return (
    <>
      <StructuredData data={structuredData} />
      <div className="landing-mobile-header">
        <button
          type="button"
          className="landing-menu-toggle"
          aria-label="Toggle landing navigation"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <button type="button" className="btn-primary landing-mobile-cta" onClick={onStartDemo}>
          Start Demo
        </button>
      </div>

      {isMobileMenuOpen && (
        <div className="landing-mobile-menu" aria-label="Mobile site links">
          <a href="#features" onClick={() => setIsMobileMenuOpen(false)}>Features</a>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setIsMobileMenuOpen(false)
              onStartDemo()
            }}
          >
            Try Demo
          </button>
        </div>
      )}

      {/* Hero Section */}
      <section className="hero">
        <div className="orb-2"></div>
        <div className="hero-content">
          <h1 className="hero-headline">
            <span className="hero-headline-line">Hire</span>
            <span className="hero-headline-line">Smarter.</span>
            <span className="hero-headline-line hero-headline-line--accent">Faster.</span>
          </h1>
          <p>
            HireFlow automates candidate screening with AI. Reduce hiring time from weeks to days, 
            eliminate bias, and make data-driven decisions. Finally, a recruiting tool built for modern teams.
          </p>
          <div className="hero-cta">
            <button className="btn-primary" onClick={onStartDemo}>
              {ctaLabel}
            </button>
            <button className="btn-ghost">Watch 2-min Demo</button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <div className="features-grid">
          <div className="feature-card">
            <h3>⚡ AI Screening</h3>
            <p>Automatically analyze and score resumes in seconds. Match candidates with roles using 20+ evaluation dimensions.</p>
          </div>
          <div className="feature-card">
            <h3>🎯 Bias Removal</h3>
            <p>Our AI evaluates candidates on merit, not on demographics. Fair, transparent, and legally defensible.</p>
          </div>
          <div className="feature-card">
            <h3>📊 Smart Analytics</h3>
            <p>Track hiring metrics, time-to-hire, and candidate quality. Data-driven insights for continuous improvement.</p>
          </div>
          <div className="feature-card">
            <h3>🔗 ATS Integration</h3>
            <p>Works seamlessly with your existing tools. No workflow disruption, just smarter hiring.</p>
          </div>
          <div className="feature-card">
            <h3>💰 Cost Savings</h3>
            <p>Reduce time-to-hire by 70%. Save $3-5K per hire by eliminating manual screening.</p>
          </div>
          <div className="feature-card">
            <h3>🔐 Privacy First</h3>
            <p>SOC 2 compliant. Your candidate data is encrypted and never shared. Enterprise-grade security.</p>
          </div>
        </div>
      </section>
    </>
  )
}
