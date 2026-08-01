import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDEXABLE_PUBLIC_ROUTES, PUBLIC_ROUTE_MANIFEST, STATIC_PUBLIC_ROUTES } from '../src/config/publicRouteManifest.js'
import { PUBLIC_PAGE_SEO, resolvePageSeo } from '../src/seo/pageSeo.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const publicDir = path.join(projectRoot, 'public')
const sitemapPath = path.join(publicDir, 'sitemap.xml')
const manifestPath = path.join(publicDir, 'site.webmanifest')
const sitemapGeneratorPath = path.join(projectRoot, 'scripts', 'generate-sitemap.mjs')
const vercelConfigPath = path.join(projectRoot, 'vercel.json')
const REQUIRED_PUBLIC_ASSETS = [
  'hireflow-icon.png',
  'hireflow-logo.png',
  'og-default.png',
  'site.webmanifest',
]
const SITE_URL = 'https://hireflow.dev'
const LEGACY_DOMAIN = 'hireflow.ai'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function routeFromUrl(url) {
  const parsed = new URL(url)
  return parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '')
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function collectHtmlFiles(dir) {
  if (!(await pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectHtmlFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : []
  }))
  return files.flat()
}

function getSitemapUrls(sitemapXml) {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
}

const sitemapXml = await fs.readFile(sitemapPath, 'utf8')
const sitemapUrls = getSitemapUrls(sitemapXml)
const sitemapRoutes = sitemapUrls.map(routeFromUrl)
const expectedSitemapRoutes = INDEXABLE_PUBLIC_ROUTES.map((route) => route.path).sort()
const actualSitemapRoutes = [...sitemapRoutes].sort()
const manifestPaths = PUBLIC_ROUTE_MANIFEST.map((route) => route.path)
const staticPaths = STATIC_PUBLIC_ROUTES.map((route) => route.path)
const sitemapGeneratorSource = await fs.readFile(sitemapGeneratorPath, 'utf8')
const webManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const vercelConfig = JSON.parse(await fs.readFile(vercelConfigPath, 'utf8'))
const robotsHeaderSources = (vercelConfig.headers || [])
  .filter(({ headers }) => headers?.some(({ key, value }) => key.toLowerCase() === 'x-robots-tag' && value.toLowerCase() === 'noindex, follow'))
  .map(({ source }) => source)
const noindexRoutes = Object.keys(PUBLIC_PAGE_SEO).filter((route) => {
  const seo = resolvePageSeo({ pathname: route, siteUrl: SITE_URL })
  return seo.robots?.toLowerCase().includes('noindex')
})

assert(!sitemapXml.includes(LEGACY_DOMAIN), 'Sitemap must not reference hireflow.ai.')
assert(!sitemapXml.includes('<lastmod>'), 'Sitemap lastmod values must be omitted unless they represent substantive per-page updates.')
assert(!sitemapGeneratorSource.includes('<lastmod>'), 'Sitemap generator must not emit deployment-time lastmod values.')
assert(sitemapUrls.every((url) => url.startsWith(`${SITE_URL}/`) || url === SITE_URL), 'Sitemap URLs must use https://hireflow.dev.')
assert(new Set(sitemapRoutes).size === sitemapRoutes.length, 'Sitemap routes must be unique.')
assert(
  JSON.stringify(actualSitemapRoutes) === JSON.stringify(expectedSitemapRoutes),
  `Sitemap must exactly match indexable public routes. Expected: ${expectedSitemapRoutes.join(', ')}. Actual: ${actualSitemapRoutes.join(', ')}.`,
)

for (const asset of REQUIRED_PUBLIC_ASSETS) {
  assert(await pathExists(path.join(publicDir, asset)), `Required public SEO asset is missing: ${asset}`)
}

for (const icon of webManifest.icons || []) {
  const iconPath = String(icon.src || '').replace(/^\/+/, '')
  assert(iconPath, 'Every web manifest icon must have a src.')
  assert(await pathExists(path.join(publicDir, iconPath)), `Web manifest icon is missing: ${icon.src}`)
}

for (const route of noindexRoutes) {
  assert(!sitemapRoutes.includes(route), `Noindex route ${route} must not be listed in sitemap.xml.`)
}

assert(Object.keys(PUBLIC_PAGE_SEO).every((route) => manifestPaths.includes(route)), 'SEO metadata may only reference manifest routes.')
assert(manifestPaths.every((route) => PUBLIC_PAGE_SEO[route]), 'Every public manifest route must have SEO metadata.')
assert(PUBLIC_PAGE_SEO['/demo']?.robots === 'noindex, follow', '/demo must explicitly use noindex, follow metadata.')
assert(!sitemapRoutes.includes('/demo'), '/demo must remain excluded from sitemap.xml while noindex.')
assert(!staticPaths.includes('/demo'), '/demo must remain outside static SSR generation.')
assert(PUBLIC_PAGE_SEO['/cookie-policy'], '/cookie-policy must have route-specific SEO metadata.')
assert(sitemapRoutes.includes('/cookie-policy'), '/cookie-policy must remain listed in sitemap.xml.')
assert(staticPaths.includes('/cookie-policy'), '/cookie-policy must be included in static public routes.')

const cookieRewrite = vercelConfig.rewrites?.find(({ source }) => source === '/cookie-policy')
assert(cookieRewrite?.destination === '/cookie-policy/index.html', '/cookie-policy must serve its generated document.')
assert(vercelConfig.trailingSlash === false, 'Vercel trailingSlash must remain false.')
assert(
  robotsHeaderSources.some((source) => source.includes('login') && source.includes('signup')),
  'Authentication routes must receive a deployed noindex, follow header.',
)
assert(
  robotsHeaderSources.some((source) => source.includes('dashboard') && source.includes('admin')),
  'Authenticated application routes must receive a deployed noindex, follow header.',
)
const canonicalRedirect = vercelConfig.redirects?.find(({ source }) => source === '/:path*')
assert(canonicalRedirect?.destination === 'https://hireflow.dev/:path*', 'Canonical www redirect must remain configured.')

const htmlFiles = await collectHtmlFiles(distDir)
for (const filePath of htmlFiles) {
  const html = await fs.readFile(filePath, 'utf8')
  assert(!html.includes(LEGACY_DOMAIN), `Built HTML must not reference hireflow.ai: ${path.relative(projectRoot, filePath)}`)
}

console.log('SEO consistency checks passed.')
