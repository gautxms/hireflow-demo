import { INTENT_PAGE_ORDER, getIntentPage } from './intentPages'

function getRelatedLinks(pathname) {
  return INTENT_PAGE_ORDER.filter((route) => route !== pathname)
}

export default function IntentLandingPage({ pathname }) {
  const page = getIntentPage(pathname)

  if (!page) {
    return null
  }

  const relatedLinks = getRelatedLinks(pathname)

  return (
    <article className="public-page">
      <section className="public-page-hero">
        <span className="public-pill">SEO landing page</span>
        <h1 className="public-page-title">{page.h1}</h1>
        <p className="public-page-subtitle">{page.hero}</p>
        <div className="public-button-row center" style={{ marginTop: '1.5rem' }}>
          <a className="btn-primary" href="/demo">{page.ctaLabel}</a>
          <a className="btn-ghost" href="/pricing">View pricing</a>
        </div>
      </section>

      <section className="public-section">
        <h2 className="public-section-title">Why hiring teams choose HireFlow</h2>
        <div className="public-faq-grid">
          {page.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 36)} className="public-copy">{paragraph}</p>
          ))}
        </div>
      </section>

      <section className="public-section public-section-alt">
        <h2 className="public-section-title">Next steps for your team</h2>
        <div className="public-feature-grid">
          <a className="public-card" href="/demo">
            <h3 className="public-card-title">Book your tailored demo</h3>
            <p className="public-card-copy">Walk through your current workflow and see how to reduce screening time in your actual hiring process.</p>
          </a>
          <a className="public-card" href="/pricing">
            <h3 className="public-card-title">Explore pricing options</h3>
            <p className="public-card-copy">Compare plans and pick the setup that matches your hiring volume, team structure, and growth goals.</p>
          </a>
          {relatedLinks.map((route) => (
            <a key={route} className="public-card" href={route}>
              <h3 className="public-card-title">Related use case: {route.slice(1).replaceAll('-', ' ')}</h3>
              <p className="public-card-copy">Review this related solution page to compare goals, workflows, and expected recruiting outcomes.</p>
            </a>
          ))}
        </div>
      </section>

      <section className="public-section">
        <h2 className="public-section-title">Frequently asked questions</h2>
        <div className="public-faq-grid">
          {page.faqs.map((faq) => (
            <div key={faq.q} className="public-card">
              <h3 className="public-card-title">{faq.q}</h3>
              <p className="public-card-copy">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="public-cta-footer">
        <h2 className="public-section-title center">Ready to accelerate hiring?</h2>
        <p className="public-copy center public-max-800">
          See how HireFlow helps your team screen resumes faster, shortlist with confidence, and improve hiring consistency.
        </p>
        <div className="public-button-row center" style={{ marginTop: '1rem' }}>
          <a className="btn-primary" href="/demo">Request demo</a>
          <a className="btn-ghost" href="/pricing">See pricing</a>
        </div>
      </section>
    </article>
  )
}
