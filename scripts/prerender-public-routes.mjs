import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildSeoHeadMarkup, resolvePageSeo } from '../src/seo/pageSeo.js'

const DIST_DIR = resolve(process.cwd(), 'dist')
const INDEX_PATH = resolve(DIST_DIR, 'index.html')
const SITE_URL = process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://hireflow.ai'

const PUBLIC_ROUTES = [
  {
    route: '/',
    currentPage: 'landing',
    body: `
      <main>
        <section>
          <h1>Hire smarter and faster with HireFlow</h1>
          <p>HireFlow helps recruiting teams screen resumes with AI so they can focus on the strongest candidates first.</p>
        </section>
        <section>
          <h2>Why teams choose HireFlow</h2>
          <p>Reduce manual resume review, improve consistency, and move qualified candidates to interviews quickly.</p>
        </section>
      </main>
    `,
  },
  {
    route: '/pricing',
    body: `
      <main>
        <h1>Simple, transparent pricing</h1>
        <p>Choose a Starter, Pro, or Enterprise plan based on your monthly hiring volume and team size.</p>
      </main>
    `,
  },
  {
    route: '/about',
    body: `
      <main>
        <h1>About HireFlow</h1>
        <p>We build AI tools that help recruiting teams hire fairly, quickly, and with better confidence.</p>
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
    route: '/refund-policy',
    body: `
      <main>
        <h1>Refund Policy</h1>
        <p>Understand trial terms, non-refundable charges after conversion, and how to contact billing support.</p>
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

const withBody = (html, body) => html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)

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
