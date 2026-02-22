import { useEffect } from 'react'
import '../globals.css'

export default function LandingPage({ onStartDemo, onViewPricing, onViewDashboard }) {
  useEffect(() => {
    // Smooth scroll and interactive effects
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault()
        const target = document.querySelector(this.getAttribute('href'))
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      })
    })
  }, [])

  return (
    <>
      {/* Navigation */}
      <nav>
        <div className="nav-logo">
          Hire<span>Flow</span>
        </div>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#about">About</a></li>
        </ul>
        <div className="nav-cta">
          <button className="btn-ghost">Sign In</button>
          <button className="btn-primary" onClick={onStartDemo}>Get Started</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="orb-2"></div>
        <div className="hero-content">
          <h1>
            Hire Smarter.
            <br />
            <span className="gradient">Faster.</span>
          </h1>
          <p>
            HireFlow automates candidate screening with AI. Reduce hiring time from weeks to days, 
            eliminate bias, and make data-driven decisions. Finally, a recruiting tool built for modern teams.
          </p>
          <div className="hero-cta">
            <button className="btn-primary" onClick={onStartDemo} style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}>
              Try Free Demo
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

      {/* Footer */}
      <footer>
        <p>© 2026 HireFlow Inc. All rights reserved. | <a href="#" style={{ color: 'var(--accent)' }}>Privacy</a> | <a href="#" style={{ color: 'var(--accent)' }}>Terms</a></p>
      </footer>
    </>
  )
}
