import { useEffect } from 'react'
import '../styles/landing.css'
import PublicPageLayout from './public/PublicPageLayout'

export default function LandingPage({ onStartDemo, ctaLabel = 'Try Free Demo' }) {
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
    <PublicPageLayout>
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

      <section className="public-section public-page-main">
        <h2 className="public-section-title center">How Hireflow works</h2>
        <div className="public-feature-grid">
          <article className="public-card">
            <h3 className="public-card-title">1) Upload resumes in bulk</h3>
            <p className="public-card-copy">
              Drag and drop candidate resumes for a single role or multiple open roles in minutes. Hireflow ingests each profile,
              extracts relevant experience, and structures skills, tenure, and domain signals so recruiters are not stuck reading
              every CV line by line. This creates a clean starting point for consistent screening across all applicants.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">2) AI scores and ranks candidates</h3>
            <p className="public-card-copy">
              Hireflow evaluates each resume against role requirements and produces ranked candidates with clear scoring rationale.
              Instead of relying on gut feel or keyword-only filters, your team gets a repeatable framework that weighs experience
              relevance, skills alignment, and hiring context. You can quickly spot top matches and identify promising candidates that
              may need a second look.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">3) Review shortlist and hire</h3>
            <p className="public-card-copy">
              Recruiters and hiring managers review a focused shortlist with transparent candidate summaries and actionable next steps.
              With the first-pass screening burden reduced, your team can spend more time on interviews, calibration, and candidate
              experience. The result is faster, more confident hiring decisions without sacrificing quality.
            </p>
          </article>
        </div>
      </section>

      <section className="public-section public-section-alt public-page-main">
        <h2 className="public-section-title center">Who uses Hireflow</h2>
        <div className="public-feature-grid">
          <article className="public-card">
            <h3 className="public-card-title">HR Managers at growing companies</h3>
            <p className="public-card-copy">
              Growing teams often need to fill multiple roles at once while maintaining quality and fairness. Hireflow helps HR managers
              standardize early-stage screening so every applicant is reviewed against consistent criteria, even when hiring volume spikes.
              That consistency improves recruiter-manager alignment and shortens the path from application to interview.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">Recruitment agencies handling high volumes</h3>
            <p className="public-card-copy">
              Agencies need to triage large candidate pools quickly while preserving client trust in shortlist quality. Hireflow supports
              bulk resume analysis workflows that surface top-fit profiles faster, reducing manual review time and enabling quicker client
              turnarounds. Teams can spend more effort on relationship-driven recruiting work and less on repetitive first-pass filtering.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">Startups hiring their first team</h3>
            <p className="public-card-copy">
              Early-stage companies usually lack dedicated recruiting operations but still need strong hiring decisions from day one.
              Hireflow gives founders and lean teams a practical screening system so they can prioritize candidates with confidence and
              avoid costly mis-hires. It provides structure without adding process overhead that slows down fast-moving startup hiring.
            </p>
          </article>
        </div>
      </section>

      <section className="public-section public-page-main">
        <h2 className="public-section-title center">Why AI resume screening</h2>
        <ul className="public-faq-grid">
          <li className="public-card public-card-copy">
            <strong>Reduce manual CV reading time:</strong> Hireflow automates repetitive first-pass screening so recruiters can reclaim hours
            each week and focus on interviews, stakeholder alignment, and candidate communication.
          </li>
          <li className="public-card public-card-copy">
            <strong>Mitigate unconscious bias:</strong> By applying a consistent scoring framework to every applicant, Hireflow helps teams
            evaluate candidates on role-relevant signals rather than inconsistent first impressions.
          </li>
          <li className="public-card public-card-copy">
            <strong>Fix inconsistent reviewer scoring:</strong> Shared ranking logic and transparent rationale reduce drift between reviewers,
            making calibration meetings faster and shortlist decisions more defensible.
          </li>
          <li className="public-card public-card-copy">
            <strong>Improve time-to-hire:</strong> Faster triage means qualified applicants move to interviews earlier, helping teams engage
            top talent before they accept competing offers.
          </li>
          <li className="public-card public-card-copy">
            <strong>Increase confidence in shortlist quality:</strong> Clear fit summaries make it easier for hiring managers to understand
            why candidates were prioritized and to make decisions with stronger evidence.
          </li>
        </ul>
      </section>

      <section className="public-section public-section-alt public-page-main">
        <h2 className="public-section-title center">Frequently asked questions</h2>
        <div className="public-faq-grid">
          <article className="public-card">
            <h3 className="public-card-title">What is AI resume screening?</h3>
            <p className="public-card-copy">
              AI resume screening is a process that uses machine intelligence to analyze resumes against predefined role criteria.
              In Hireflow, that means converting unstructured candidate data into comparable signals so recruiters can prioritize who
              should move forward first. It accelerates top-of-funnel review while keeping people in control of final hiring decisions.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">How does Hireflow score resumes?</h3>
            <p className="public-card-copy">
              Hireflow scores resumes by matching candidate experience, skills, and role alignment signals to the job context you define.
              The platform then presents ranked candidates with transparent summaries that explain strengths, potential gaps, and fit.
              This gives teams a repeatable scoring baseline they can review and calibrate together.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">Can Hireflow handle bulk resume uploads?</h3>
            <p className="public-card-copy">
              Yes. Hireflow is designed for bulk upload workflows, allowing teams to process large applicant batches efficiently.
              Instead of reviewing files one by one, recruiters can analyze candidates at scale and quickly identify top-priority profiles.
              This is especially useful for high-volume hiring cycles and agency pipelines.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">Is Hireflow suitable for small businesses?</h3>
            <p className="public-card-copy">
              Absolutely. Small and growing businesses can use Hireflow to bring structure to hiring without building a large recruiting team.
              It helps lean teams move faster, evaluate candidates more consistently, and make better hiring decisions with limited time.
              As hiring needs expand, the same workflow can scale across additional roles and departments.
            </p>
          </article>
          <article className="public-card">
            <h3 className="public-card-title">How is Hireflow different from a regular ATS?</h3>
            <p className="public-card-copy">
              A regular ATS primarily stores candidate data and manages recruiting workflow stages. Hireflow adds AI-powered analysis on top
              of that process by ranking candidates and surfacing fit insights early in the funnel. The combination helps teams spend less
              time on administrative triage and more time interviewing the right people.
            </p>
          </article>
        </div>
      </section>

      <section className="public-section public-page-main">
        <footer className="public-cta-footer">
          <h2 className="public-section-title">Ready to hire smarter?</h2>
          <p className="public-copy center">
            If your team is spending too much time on manual first-pass screening, Hireflow gives you a faster and more consistent way
            to identify high-potential candidates. Start with your next open role, compare shortlist quality and speed, and scale the
            workflow once you see the impact on hiring outcomes.
          </p>
          <div className="public-button-row center">
            <button className="btn-primary" onClick={onStartDemo}>
              {ctaLabel}
            </button>
          </div>
        </footer>
      </section>
    </PublicPageLayout>
  )
}
