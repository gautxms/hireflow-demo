import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DIST_DIR = resolve(process.cwd(), 'dist')
const INDEX_PATH = resolve(DIST_DIR, 'index.html')

const PUBLIC_ROUTES = [
  {
    route: '/',
    title: 'HireFlow – AI Hiring Platform',
    description: 'HireFlow helps teams hire faster using AI-powered resume screening, interviews, and candidate ranking.',
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
    title: 'HireFlow Pricing',
    description: 'Explore HireFlow pricing plans for teams of every size.',
    body: `
      <main>
        <h1>Simple, transparent pricing</h1>
        <p>Choose a Starter, Pro, or Enterprise plan based on your monthly hiring volume and team size.</p>
      </main>
    `,
  },
  {
    route: '/about',
    title: 'About HireFlow',
    description: 'Learn about the HireFlow mission and team.',
    body: `
      <main>
        <h1>About HireFlow</h1>
        <p>We build AI tools that help recruiting teams hire fairly, quickly, and with better confidence.</p>
      </main>
    `,
  },
  {
    route: '/contact',
    title: 'Contact HireFlow',
    description: 'Contact the HireFlow team for sales, support, and partnership inquiries.',
    body: `
      <main>
        <h1>Contact HireFlow</h1>
        <p>Reach our team for product questions, support, and partnership opportunities.</p>
      </main>
    `,
  },
  {
    route: '/help',
    title: 'HireFlow Help Center',
    description: 'Browse help articles and support guidance for HireFlow.',
    body: `
      <main>
        <h1>Help Center</h1>
        <p>Find guides for onboarding, resume uploads, scoring, integrations, and billing support.</p>
      </main>
    `,
  },
  {
    route: '/terms',
    title: 'HireFlow Terms of Service',
    description: 'Review the HireFlow Terms of Service.',
    body: `
      <main>
        <h1>Terms of Service</h1>
        <p>Review the terms governing access to and use of the HireFlow platform.</p>
      </main>
    `,
  },
  {
    route: '/privacy',
    title: 'HireFlow Privacy Policy',
    description: 'Learn how HireFlow collects, uses, and protects information.',
    body: `
      <main>
        <h1>Privacy Policy</h1>
        <p>Learn how HireFlow processes account data and candidate information with appropriate safeguards.</p>
      </main>
    `,
  },
  {
    route: '/refund-policy',
    title: 'HireFlow Refund Policy',
    description: 'Read HireFlow refund terms for subscriptions and billing.',
    body: `
      <main>
        <h1>Refund Policy</h1>
        <p>Understand trial terms, non-refundable charges after conversion, and how to contact billing support.</p>
      </main>
    `,
  },
]

const withSeo = (html, { title, description }) => html
  .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
  .replace(/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="description" content="${description}" />`)

const withBody = (html, body) => html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)

const routeToDir = (route) => route === '/' ? DIST_DIR : resolve(DIST_DIR, route.slice(1))

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
