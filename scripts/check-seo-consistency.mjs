import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLIC_PAGE_SEO, resolvePageSeo } from '../src/seo/pageSeo.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const sitemapPath = path.join(projectRoot, 'public', 'sitemap.xml')
const prerenderScriptPath = path.join(projectRoot, 'scripts', 'prerender-public-routes.mjs')
const SITE_URL = 'https://hireflow.dev'
const LEGACY_DOMAIN = 'hireflow.ai'
const EXPECTED_PRERENDERED_SITEMAP_ROUTES = new Set(Object.keys(PUBLIC_PAGE_SEO))

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
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

async function readIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return ''
  }

  return fs.readFile(filePath, 'utf8')
}

async function collectHtmlFiles(dir) {
  if (!(await pathExists(dir))) {
    return []
  }

  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return collectHtmlFiles(entryPath)
    }
    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : []
  }))

  return files.flat()
}

function getPrerenderRoutes(scriptSource) {
  return [...scriptSource.matchAll(/route:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function getSitemapUrls(sitemapXml) {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
}

const sitemapXml = await fs.readFile(sitemapPath, 'utf8')
const sitemapUrls = getSitemapUrls(sitemapXml)
const sitemapRoutes = sitemapUrls.map(routeFromUrl)
const prerenderSource = await fs.readFile(prerenderScriptPath, 'utf8')
const prerenderRoutes = getPrerenderRoutes(prerenderSource)
const noindexRoutes = Object.keys(PUBLIC_PAGE_SEO).filter((route) => {
  const seo = resolvePageSeo({ pathname: route, siteUrl: SITE_URL })
  return seo.robots?.toLowerCase().includes('noindex')
})

assert(!sitemapXml.includes(LEGACY_DOMAIN), 'Sitemap must not reference hireflow.ai.')
assert(sitemapUrls.every((url) => url.startsWith(`${SITE_URL}/`) || url === SITE_URL), 'Sitemap URLs must use https://hireflow.dev.')

for (const route of noindexRoutes) {
  assert(!sitemapRoutes.includes(route), `Noindex route ${route} must not be listed in sitemap.xml.`)
}

for (const route of sitemapRoutes) {
  if (EXPECTED_PRERENDERED_SITEMAP_ROUTES.has(route)) {
    assert(prerenderRoutes.includes(route), `Sitemap route ${route} must be included in prerender public routes.`)
  }
}

assert(PUBLIC_PAGE_SEO['/demo']?.robots === 'noindex, follow', '/demo must explicitly use noindex, follow metadata.')
assert(!sitemapRoutes.includes('/demo'), '/demo must remain excluded from sitemap.xml while noindex.')
assert(prerenderRoutes.includes('/demo'), '/demo must be prerendered with explicit noindex metadata.')
assert(PUBLIC_PAGE_SEO['/cookie-policy'], '/cookie-policy must have route-specific SEO metadata.')
assert(sitemapRoutes.includes('/cookie-policy'), '/cookie-policy must remain listed in sitemap.xml.')
assert(prerenderRoutes.includes('/cookie-policy'), '/cookie-policy must be included in prerender public routes.')

const htmlFiles = await collectHtmlFiles(distDir)
for (const filePath of htmlFiles) {
  const html = await readIfExists(filePath)
  assert(!html.includes(LEGACY_DOMAIN), `Built HTML must not reference hireflow.ai: ${path.relative(projectRoot, filePath)}`)
}

console.log('SEO consistency checks passed.')
