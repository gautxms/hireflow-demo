import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { INDEXABLE_PUBLIC_ROUTES, PUBLIC_ROUTE_MANIFEST, STATIC_PUBLIC_ROUTES } from '../src/config/publicRouteManifest.js'
import { PROTECTED_ROUTE_EXACT_PATHS, isProtectedRoutePath } from '../src/config/routeClassification.js'
import { buildSeoHeadMarkup, PUBLIC_PAGE_SEO, resolvePageSeo } from '../src/seo/pageSeo.js'

const DIST_DIR = resolve(process.cwd(), 'dist')
const SSR_DIR = resolve(process.cwd(), 'dist-ssr')
const INDEX_PATH = resolve(DIST_DIR, 'index.html')
const SSR_ENTRY_PATH = resolve(SSR_DIR, 'entry-server.js')
const SITEMAP_PATH = resolve(DIST_DIR, 'sitemap.xml')
const VERCEL_CONFIG_PATH = resolve(process.cwd(), 'vercel.json')
const SITE_URL = process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://hireflow.dev'
const MIN_VISIBLE_WORDS = 50

const DEMO_PLACEHOLDER = `
  <main>
    <h1>Book a HireFlow demo</h1>
    <p>Choose a date and time to see HireFlow workflows in a guided product tour.</p>
  </main>
`

function validateManifest() {
  const paths = PUBLIC_ROUTE_MANIFEST.map((route) => route.path)
  const duplicatePaths = paths.filter((path, index) => paths.indexOf(path) !== index)
  if (duplicatePaths.length > 0) {
    throw new Error(`Duplicate public routes: ${[...new Set(duplicatePaths)].join(', ')}`)
  }

  const missingSeo = PUBLIC_ROUTE_MANIFEST.filter((route) => !PUBLIC_PAGE_SEO[route.path])
  if (missingSeo.length > 0) {
    throw new Error(`Public routes missing SEO metadata: ${missingSeo.map((route) => route.path).join(', ')}`)
  }

  const unknownSeo = Object.keys(PUBLIC_PAGE_SEO).filter((path) => !paths.includes(path))
  if (unknownSeo.length > 0) {
    throw new Error(`SEO metadata has routes missing from the public manifest: ${unknownSeo.join(', ')}`)
  }
}

function withSeo(html, route) {
  const seo = resolvePageSeo({ pathname: route.path, siteUrl: SITE_URL })
  const headMarkup = `<!-- SEO_DEFAULT_START -->\n    ${buildSeoHeadMarkup(seo)}\n    <!-- SEO_DEFAULT_END -->`
  return html.replace(/<!-- SEO_DEFAULT_START -->[\s\S]*?<!-- SEO_DEFAULT_END -->/i, headMarkup)
}

function withBody(html, body, { hydrate = true } = {}) {
  const marker = hydrate ? ' data-static-public-route' : ''
  const replacement = `<div id="root"${marker}>${body}</div>`
  const output = html.replace('<div id="root"></div>', replacement)
  if (output === html) {
    throw new Error('Could not find the empty React root in dist/index.html.')
  }
  return output
}

function routeToFile(pathname) {
  return pathname === '/' ? INDEX_PATH : resolve(DIST_DIR, pathname.slice(1), 'index.html')
}

function countVisibleWords(html) {
  const visibleText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, ' ')
  return visibleText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0
}

function getRenderedPageContent(renderedBody) {
  const match = renderedBody.match(/<main>([\s\S]*)<\/main>\s*<footer\b/i)
  if (!match) {
    throw new Error('Generated public route is missing the shared main content boundary.')
  }
  return match[1]
}

async function validateSitemap() {
  const sitemap = await readFile(SITEMAP_PATH, 'utf8')
  const actualRoutes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(match[1]).pathname.replace(/\/$/, '') || '/')
    .sort()
  const expectedRoutes = INDEXABLE_PUBLIC_ROUTES.map((route) => route.path).sort()
  if (new Set(actualRoutes).size !== actualRoutes.length) {
    throw new Error('Sitemap contains duplicate routes.')
  }
  if (JSON.stringify(actualRoutes) !== JSON.stringify(expectedRoutes)) {
    throw new Error(`Sitemap route coverage mismatch. Expected: ${expectedRoutes.join(', ')}. Actual: ${actualRoutes.join(', ')}.`)
  }
}

async function validateCookiePolicyRewrite() {
  const config = JSON.parse(await readFile(VERCEL_CONFIG_PATH, 'utf8'))
  const rewrite = config.rewrites?.find(({ source }) => source === '/cookie-policy')
  if (rewrite?.destination !== '/cookie-policy/index.html') {
    throw new Error('Vercel /cookie-policy rewrite must serve /cookie-policy/index.html.')
  }
}

async function validateGeneratedFiles() {
  for (const route of STATIC_PUBLIC_ROUTES) {
    if (isProtectedRoutePath(route.path)) {
      throw new Error(`Protected route reached generated output validation: ${route.path}`)
    }
    const html = await readFile(routeToFile(route.path), 'utf8')
    if (!html.includes('data-static-public-route')) {
      throw new Error(`Generated route ${route.path} is missing its hydration marker.`)
    }

    const wordCount = countVisibleWords(getRenderedPageContent(html))
    if (wordCount < MIN_VISIBLE_WORDS) {
      throw new Error(`Generated route ${route.path} is near-empty after writing (${wordCount} visible words).`)
    }
  }

  for (const protectedPath of PROTECTED_ROUTE_EXACT_PATHS) {
    try {
      await readFile(routeToFile(protectedPath), 'utf8')
      throw new Error(`Protected route was accidentally generated: ${protectedPath}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

async function prerender() {
  validateManifest()
  await validateSitemap()
  await validateCookiePolicyRewrite()

  const templateHtml = await readFile(INDEX_PATH, 'utf8')
  const serverEntry = await import(`${pathToFileURL(SSR_ENTRY_PATH).href}?v=${Date.now()}`)
  const bundledRoutes = new Set(serverEntry.staticPublicRoutes)
  const missingBundleRoutes = STATIC_PUBLIC_ROUTES.filter((route) => !bundledRoutes.has(route.path))
  if (missingBundleRoutes.length > 0 || bundledRoutes.size !== STATIC_PUBLIC_ROUTES.length) {
    throw new Error('SSR bundle route inventory does not match the public route manifest.')
  }

  for (const route of STATIC_PUBLIC_ROUTES) {
    const renderedBody = serverEntry.renderPublicRoute(route.path)
    const routeHtml = withBody(withSeo(templateHtml, route), renderedBody)
    const wordCount = countVisibleWords(getRenderedPageContent(renderedBody))
    if (wordCount < MIN_VISIBLE_WORDS) {
      throw new Error(`Generated route ${route.path} is near-empty (${wordCount} visible words; minimum ${MIN_VISIBLE_WORDS}).`)
    }

    const outputPath = routeToFile(route.path)
    await mkdir(resolve(outputPath, '..'), { recursive: true })
    await writeFile(outputPath, routeHtml)
    console.log(`Generated ${route.path} (${wordCount} visible words).`)
  }

  const demoRoute = PUBLIC_ROUTE_MANIFEST.find((route) => route.path === '/demo')
  const demoHtml = withBody(withSeo(templateHtml, demoRoute), DEMO_PLACEHOLDER, { hydrate: false })
  await mkdir(resolve(DIST_DIR, 'demo'), { recursive: true })
  await writeFile(routeToFile('/demo'), demoHtml)

  await validateGeneratedFiles()

  await rm(SSR_DIR, { recursive: true, force: true })
  console.log(`Statically generated ${STATIC_PUBLIC_ROUTES.length} public routes; retained the /demo placeholder.`)
}

prerender().catch((error) => {
  console.error('Failed to generate public routes.', error)
  process.exitCode = 1
})
