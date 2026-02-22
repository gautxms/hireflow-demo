import { useEffect } from 'react'
import '../globals.css'

export default function LandingPage({ onStartDemo, onViewPricing, onViewAbout, onViewContact, onViewHelp }) {
  useEffect(() => {
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
      <nav>
        <div className="nav-logo">
          Hire<span>Flow</span>
        </div>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><button onClick={onViewPricing} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '400', letterSpacing: '0.02em' }}>Pricing</button></li>
          <li><button onClick={onViewAbout} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '400', letterSpacing: '0.02em' }}>About</button></li>
          <li><button onClick={onViewHelp} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '400', letterSpacing: '0.02em' }}>Help</button></li>
        </ul>
        <div className="nav-cta">
          <button className="btn-ghost" onClick={onViewContact}>Contact</button>
          <button className="btn-primary" onClick={onStartDemo}>Start Beta</button>
        </div>
      </nav>

      <section className="hero">
        <div className="orb-2"></div>
        <div className="hero-content">
          <div style={{ display: 'inline-block', marginBottom: '1rem', padding: '0.4rem 0.8rem', borderRadius: '999px', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 'bold' }}>
            BETA PRODUCT
          </div>
          <h1>
            Review Resumes.
            <br />
            <span className="gradient">Move Faster.</span>
          </h1>
          <p>
            HireFlow helps small teams parse resumes quickly so you can spend less time on manual screening and more time talking to strong candidates.
          </p>
          <div className="hero-cta">
            <button className="btn-primary" onClick={onStartDemo} style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}>
              Start Beta
            </button>
            <button className="btn-ghost" onClick={onViewPricing}>View Beta Access</button>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <div className="features-grid">
          <div className="feature-card">
            <h3>📄 Resume Upload</h3>
            <p>Upload one or multiple PDF resumes and process them in a single flow.</p>
          </div>
          <div className="feature-card">
            <h3>🧩 Resume Parsing</h3>
            <p>Extract candidate details like name, skills, and experience from uploaded resumes.</p>
          </div>
          <div className="feature-card">
            <h3>🔗 ATS Integration</h3>
            <p>ATS integrations are on our roadmap and available for selected beta design partners.</p>
          </div>
          <div className="feature-card">
            <h3>🔐 Privacy First</h3>
            <p>Candidate files stay private in your workspace with secure handling throughout the beta.</p>
          </div>
        </div>
      </section>

      <footer>
        <p>© 2026 HireFlow Inc. All rights reserved. | <a href="#" style={{ color: 'var(--accent)' }}>Privacy</a> | <a href="#" style={{ color: 'var(--accent)' }}>Terms</a></p>
      </footer>
    </>
  )
}
