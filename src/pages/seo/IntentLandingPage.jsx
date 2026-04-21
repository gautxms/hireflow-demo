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
        <span className="public-pill">Solutions</span>
        <h1 className="public-page-title">{page.h1}</h1>
        <p className="public-page-subtitle">{page.hero}</p>
        <div className="public-button-row center public-mt-lg">
          <a className="btn-primary" href="/demo">{page.ctaLabel}</a>
          <a className="btn-ghost" href="/pricing">View pricing</a>
        </div>
      </section>

      <section className="public-section">
        <h2 className="public-section-title">Problems we solve for modern hiring teams</h2>
        <div className="public-faq-grid">
          {page.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 36)} className="public-copy">{paragraph}</p>
          ))}
        </div>
      </section>

      <section className="public-section public-section-alt">
        <h2 className="public-section-title">Persona pain points this solution addresses</h2>
        <div className="public-feature-grid">
          {page.personaPainPoints.map((item) => (
            <article key={item.title} className="public-card">
              <h3 className="public-card-title">{item.title}</h3>
              <p className="public-card-copy">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section">
        <h2 className="public-section-title">Expected hiring outcomes</h2>
        <div className="public-feature-grid">
          {page.outcomes.map((item) => (
            <article key={item.title} className="public-card">
              <h3 className="public-card-title">{item.title}</h3>
              <p className="public-card-copy">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section public-section-alt">
        <h2 className="public-section-title">Take the next step</h2>
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
              <p className="public-card-copy">Review this related solution page to compare hiring bottlenecks and expected outcomes.</p>
            </a>
          ))}
        </div>
      </section>
    </article>
  )
}
