import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildSeoHeadMarkup, resolvePageSeo } from '../src/seo/pageSeo.js'

const DIST_DIR = resolve(process.cwd(), 'dist')
const INDEX_PATH = resolve(DIST_DIR, 'index.html')
const SITE_URL = process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://hireflow.dev'
const DEMO_VIDEO_URL = process.env.VITE_DEMO_VIDEO_URL?.trim() || ''
const landingHeroSecondaryCta = DEMO_VIDEO_URL
  ? '<button type="button" class="btn-ghost btn-ghost--accent">Watch demo</button>'
  : ''

const PUBLIC_ROUTES = [
  {
    route: '/',
    currentPage: 'landing',
    body: `
      <div class="public-page-layout">
        <main class="public-page-main">
          <section class="hero" aria-labelledby="landing-prerender-heading">
            <div class="orb-2" aria-hidden="true"></div>
            <div class="hero-content">
              <h1 id="landing-prerender-heading" class="hero-headline">
                <span class="hero-headline-line">Hire</span>
                <span class="hero-headline-line">Smarter.</span>
                <span class="hero-headline-line hero-headline-line--accent">Faster.</span>
              </h1>
              <p>
                HireFlow supports candidate screening with AI-assisted resume review, structured recommendations,
                and clearer context for recruiter-led decisions.
              </p>
              <div class="hero-cta">
                <a class="btn-primary" href="/pricing">Try Free Demo</a>
                ${landingHeroSecondaryCta}
              </div>
            </div>
          </section>
          <section class="features" id="features" aria-labelledby="landing-prerender-features">
            <h2 id="landing-prerender-features" class="public-section-title center">Why teams choose HireFlow</h2>
            <div class="features-grid">
              <article class="feature-card">
                <h3>AI Screening</h3>
                <p>Analyze resumes against role requirements and surface structured candidate signals for recruiter review.</p>
              </article>
              <article class="feature-card">
                <h3>Structured Review</h3>
                <p>Evaluate candidates on merit with a consistent framework designed to reduce manual screening variance.</p>
              </article>
              <article class="feature-card">
                <h3>Smart Analytics</h3>
                <p>Track hiring metrics, time-to-hire, and candidate quality so teams can make data-driven decisions.</p>
              </article>
            </div>
          </section>
        </main>
      </div>
    `,
  },
  {
    route: '/pricing',
    body: `
      <main>
        <h1>Choose your plan</h1>
        <p>HireFlow offers monthly billing at $99/month or annual billing at $999/year, equivalent to $83.25/month. Both plans include a 7-day free trial and up to 800 resume analyses/month.</p>
      </main>
    `,
  },
  {
    route: '/about',
    body: `
      <main>
        <h1>About HireFlow</h1>
        <p>We build AI tools that help recruiting teams review candidates more consistently, quickly, and with clearer context.</p>
      </main>
    `,
  },
  {
    route: '/contact',
    body: `
      <main>
        <h1>Contact HireFlow</h1>
        <p>Reach our team for product questions, support, and partnership opportunities.</p>
      </main>
    `,
  },
  {
    route: '/help',
    body: `
      <main>
        <h1>Help Center</h1>
        <p>Find guides for onboarding, resume uploads, scoring, integrations, and billing support.</p>
      </main>
    `,
  },
  {
    route: '/demo',
    currentPage: 'demo',
    body: `
      <main>
        <h1>Book a HireFlow demo</h1>
        <p>Choose a date and time to see HireFlow workflows in a guided product tour.</p>
      </main>
    `,
  },
  {
    route: '/terms',
    body: `
      <main>
        <h1>Terms of Service</h1>
        <p>Review the terms governing access to and use of the HireFlow platform.</p>
      </main>
    `,
  },
  {
    route: '/privacy',
    body: `
      <main>
        <h1>Privacy Policy</h1>
        <p>Learn how HireFlow processes account data and candidate information with appropriate safeguards.</p>
      </main>
    `,
  },
  {
    route: '/ai-disclosure',
    body: `
      <main>
        <h1>AI Disclosure</h1>
        <p>Learn how HireFlow uses AI-assisted resume analysis as decision support, not automated hiring decisions.</p>
      </main>
    `,
  },
  {
    route: '/refund-policy',
    body: `
      <main>
        <h1>Refund Policy</h1>
        <p>Understand trial terms, non-refundable charges after conversion, and how to contact billing support.</p>
      </main>
    `,
  },
  {
    route: '/ai-resume-screening',
    body: `
      <main>
        <h1>AI Resume Screening Software</h1>
        <p>Evaluate applicants against role requirements and prioritize review with structured AI-assisted recommendations.</p>
      </main>
    `,
  },
  {
    route: '/bulk-resume-analysis',
    body: `
      <main>
        <h1>Bulk Resume Analysis</h1>
        <p>Upload and analyze candidate batches with structured scoring support to reduce manual triage time.</p>
      </main>
    `,
  },
  {
    route: '/resume-scoring-ai',
    body: `
      <main>
        <h1>Resume Scoring AI</h1>
        <p>Use transparent, role-aware AI scoring to compare applicants consistently and identify candidates for human review.</p>
      </main>
    `,
  },
  {
    route: '/automated-candidate-shortlisting',
    body: `
      <main>
        <h1>Automated Candidate Shortlisting</h1>
        <p>Generate candidate rankings with clear rationale so hiring teams can review shortlists with more context.</p>
      </main>
    `,
  },
]

const withSeo = (html, routeConfig) => {
  const seo = resolvePageSeo({
    pathname: routeConfig.route,
    currentPage: routeConfig.currentPage || null,
    siteUrl: SITE_URL,
  })

  const headMarkup = `<!-- SEO_DEFAULT_START -->\n    ${buildSeoHeadMarkup(seo)}\n    <!-- SEO_DEFAULT_END -->`

  return html.replace(/<!-- SEO_DEFAULT_START -->[\s\S]*?<!-- SEO_DEFAULT_END -->/i, headMarkup)
}

const withBody = (html, body) =>
  html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)

const routeToDir = (route) => (route === '/' ? DIST_DIR : resolve(DIST_DIR, route.slice(1)))

async function prerender() {
  const indexHtml = await readFile(INDEX_PATH, 'utf8')

  for (const routeConfig of PUBLIC_ROUTES) {
    const routeHtml = withBody(withSeo(indexHtml, routeConfig), routeConfig.body)
    const outputDir = routeToDir(routeConfig.route)
    await mkdir(outputDir, { recursive: true })
    await writeFile(resolve(outputDir, 'index.html'), routeHtml)
  }

  console.log(`Prerendered ${PUBLIC_ROUTES.length} public routes into static HTML.`)
}

prerender().catch((error) => {
  console.error('Failed to prerender public routes.', error)
  process.exitCode = 1
})
