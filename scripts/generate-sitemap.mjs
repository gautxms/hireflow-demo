import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDEXABLE_PUBLIC_ROUTES, PUBLIC_ROUTE_MANIFEST } from '../src/config/publicRouteManifest.js'
import { PUBLIC_PAGE_SEO } from '../src/seo/pageSeo.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')
const sitemapPath = path.join(publicDir, 'sitemap.xml')
const SITE_URL = process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://hireflow.dev'

function xmlEscape(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function validateSeoInventory() {
  const manifestPaths = PUBLIC_ROUTE_MANIFEST.map((route) => route.path)
  const missingSeo = manifestPaths.filter((route) => !PUBLIC_PAGE_SEO[route])
  const unknownSeo = Object.keys(PUBLIC_PAGE_SEO).filter((route) => !manifestPaths.includes(route))
  if (missingSeo.length || unknownSeo.length) {
    throw new Error(`Public manifest/SEO drift detected. Missing SEO: ${missingSeo.join(', ') || 'none'}. Unknown SEO: ${unknownSeo.join(', ') || 'none'}.`)
  }
}

async function generateSitemap() {
  validateSeoInventory()
  const indexableRoutes = [...INDEXABLE_PUBLIC_ROUTES].sort((left, right) => left.path.localeCompare(right.path))
  const urlEntries = indexableRoutes
    .map(({ path: route }) => {
      const absoluteUrl = new URL(route, SITE_URL).toString()
      return `  <url>\n    <loc>${xmlEscape(absoluteUrl)}</loc>\n  </url>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`
  await fs.mkdir(publicDir, { recursive: true })
  await fs.writeFile(sitemapPath, xml, 'utf8')
  console.log(`Generated sitemap with ${indexableRoutes.length} routes at ${sitemapPath}`)
}

generateSitemap().catch((error) => {
  console.error('Failed to generate sitemap:', error)
  process.exitCode = 1
})
