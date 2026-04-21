import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')
const seoPagesDir = path.join(projectRoot, 'src', 'pages', 'seo')
const sitemapPath = path.join(publicDir, 'sitemap.xml')

const SITE_URL = 'https://hireflow.dev'

const STATIC_INDEXABLE_ROUTES = [
  '/',
  '/pricing',
  '/about',
  '/contact',
  '/help',
  '/terms',
  '/privacy',
  '/refund-policy',
  '/ai-resume-screening',
  '/bulk-resume-analysis',
  '/resume-scoring-ai',
  '/automated-candidate-shortlisting',
]

function toRouteFromSeoFile(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const slug = baseName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()

  return `/${slug}`
}

async function getSeoLandingRoutes() {
  try {
    const entries = await fs.readdir(seoPagesDir, { withFileTypes: true })

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(jsx|tsx|js|ts)$/.test(name) && !name.startsWith('_'))
      .filter((name) => !['IntentLandingPage.jsx', 'intentPages.js'].includes(name))
      .map(toRouteFromSeoFile)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function xmlEscape(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function generateSitemap() {
  const seoLandingRoutes = await getSeoLandingRoutes()
  const allRoutes = [...new Set([...STATIC_INDEXABLE_ROUTES, ...seoLandingRoutes])].sort()
  const lastmod = new Date().toISOString().split('T')[0]

  const urlEntries = allRoutes
    .map((route) => {
      const absoluteUrl = new URL(route, SITE_URL).toString()
      return `  <url>\n    <loc>${xmlEscape(absoluteUrl)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`

  await fs.mkdir(publicDir, { recursive: true })
  await fs.writeFile(sitemapPath, xml, 'utf8')

  console.log(`Generated sitemap with ${allRoutes.length} routes at ${sitemapPath}`)
}

generateSitemap().catch((error) => {
  console.error('Failed to generate sitemap:', error)
  process.exitCode = 1
})
