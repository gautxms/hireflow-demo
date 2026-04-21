const DEFAULT_SITE_URL = 'https://hireflow.ai'
const DEFAULT_OG_IMAGE = '/og-default.png'

export const SEO_DEFAULTS = {
  title: 'HireFlow – AI Hiring Platform',
  description: 'HireFlow helps teams hire faster using AI-powered resume screening, interviews, and candidate ranking.',
  path: '/',
  type: 'website',
  image: DEFAULT_OG_IMAGE,
  twitterCard: 'summary_large_image',
  robots: 'index, follow',
}

export const PUBLIC_PAGE_SEO = {
  '/': {
    title: 'HireFlow – AI Hiring Platform',
    description: 'HireFlow helps teams hire faster using AI-powered resume screening, interviews, and candidate ranking.',
  },
  '/about': {
    title: 'About HireFlow',
    description: 'Meet the HireFlow team and learn how we help talent teams hire faster and more consistently with AI.',
  },
  '/contact': {
    title: 'Contact HireFlow',
    description: 'Contact HireFlow for product help, sales conversations, partnerships, and enterprise onboarding.',
  },
  '/help': {
    title: 'HireFlow Help Center',
    description: 'Find onboarding guides, troubleshooting steps, and support resources in the HireFlow Help Center.',
  },
  '/demo': {
    title: 'Book a HireFlow Demo',
    description: 'Schedule a live HireFlow demo to see AI-powered resume screening, candidate scoring, and hiring workflows.',
  },
  '/pricing': {
    title: 'HireFlow Pricing',
    description: 'Choose monthly or yearly HireFlow pricing plans with a 7-day free trial and flexible team scaling.',
  },
  '/terms': {
    title: 'HireFlow Terms of Service',
    description: 'Review the HireFlow Terms of Service for using our resume screening platform and related features.',
  },
  '/privacy': {
    title: 'HireFlow Privacy Policy',
    description: 'Learn how HireFlow collects, uses, and protects personal information processed on our hiring platform.',
  },
  '/refund-policy': {
    title: 'HireFlow Refund Policy',
    description: 'Read HireFlow refund terms for subscriptions, trials, and billing support response timelines.',
  },
  '/ai-resume-screening': {
    title: 'AI Resume Screening Software for Faster Hiring | HireFlow',
    description: 'Speed up top-of-funnel hiring with AI resume screening that helps recruiters prioritize qualified candidates quickly and consistently.',
  },
  '/bulk-resume-analysis': {
    title: 'Bulk Resume Analysis for High-Volume Recruiting | HireFlow',
    description: 'Analyze large resume batches with role-based scoring and fast triage workflows built for high-volume hiring teams.',
  },
  '/resume-scoring-ai': {
    title: 'Resume Scoring AI for Candidate Prioritization | HireFlow',
    description: 'Use transparent resume scoring AI to align recruiters and hiring managers on stronger interview shortlists.',
  },
  '/automated-candidate-shortlisting': {
    title: 'Automated Candidate Shortlisting Platform | HireFlow',
    description: 'Automate candidate shortlisting with role-based analysis so your team can build higher-quality interview slates in less time.',
  },
}

function normalizePath(pathname = '/') {
  const cleanPath = pathname.split('?')[0].split('#')[0]
  return cleanPath === '' ? '/' : cleanPath
}

function normalizeSiteUrl(siteUrl = DEFAULT_SITE_URL) {
  return siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl
}

export function resolvePageSeo({ pathname = '/', currentPage = null, siteUrl = DEFAULT_SITE_URL } = {}) {
  const normalizedPath = normalizePath(pathname)
  const fallbackPath = normalizedPath === '/' && currentPage && PUBLIC_PAGE_SEO[`/${currentPage}`] ? `/${currentPage}` : normalizedPath
  const routeSeo = PUBLIC_PAGE_SEO[fallbackPath] || PUBLIC_PAGE_SEO[normalizedPath] || {}

  const merged = {
    ...SEO_DEFAULTS,
    ...routeSeo,
  }

  const canonicalPath = routeSeo.path || fallbackPath || normalizedPath || '/'
  const canonicalUrl = `${normalizeSiteUrl(siteUrl)}${canonicalPath === '/' ? '' : canonicalPath}`
  const imageUrl = merged.image.startsWith('http') ? merged.image : `${normalizeSiteUrl(siteUrl)}${merged.image}`

  return {
    ...merged,
    url: canonicalUrl,
    image: imageUrl,
  }
}

function upsertMeta(doc, selector, attributes) {
  let tag = doc.head.querySelector(selector)

  if (!tag) {
    tag = doc.createElement('meta')
    Object.entries(attributes).forEach(([key, value]) => {
      if (key !== 'content') {
        tag.setAttribute(key, value)
      }
    })
    doc.head.appendChild(tag)
  }

  tag.setAttribute('content', attributes.content)
  tag.setAttribute('data-seo-managed', 'true')

  const duplicates = doc.head.querySelectorAll(selector)
  duplicates.forEach((duplicate, index) => {
    if (index > 0) {
      duplicate.parentNode?.removeChild(duplicate)
    }
  })
}

function upsertCanonical(doc, href) {
  let canonical = doc.head.querySelector('link[rel="canonical"]')

  if (!canonical) {
    canonical = doc.createElement('link')
    canonical.setAttribute('rel', 'canonical')
    doc.head.appendChild(canonical)
  }

  canonical.setAttribute('href', href)
  canonical.setAttribute('data-seo-managed', 'true')

  const duplicates = doc.head.querySelectorAll('link[rel="canonical"]')
  duplicates.forEach((duplicate, index) => {
    if (index > 0) {
      duplicate.parentNode?.removeChild(duplicate)
    }
  })
}

export function applySeoToDocument(doc, seo) {
  doc.title = seo.title

  upsertMeta(doc, 'meta[name="description"]', { name: 'description', content: seo.description })
  if (seo.robots) {
    upsertMeta(doc, 'meta[name="robots"]', { name: 'robots', content: seo.robots })
  }
  upsertCanonical(doc, seo.url)

  upsertMeta(doc, 'meta[property="og:title"]', { property: 'og:title', content: seo.title })
  upsertMeta(doc, 'meta[property="og:description"]', { property: 'og:description', content: seo.description })
  upsertMeta(doc, 'meta[property="og:url"]', { property: 'og:url', content: seo.url })
  upsertMeta(doc, 'meta[property="og:type"]', { property: 'og:type', content: seo.type })
  upsertMeta(doc, 'meta[property="og:image"]', { property: 'og:image', content: seo.image })

  upsertMeta(doc, 'meta[name="twitter:card"]', { name: 'twitter:card', content: seo.twitterCard })
  upsertMeta(doc, 'meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title })
  upsertMeta(doc, 'meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description })
  upsertMeta(doc, 'meta[name="twitter:image"]', { name: 'twitter:image', content: seo.image })
}

export function buildSeoHeadMarkup(seo) {
  return [
    `<title>${seo.title}</title>`,
    `<meta name="description" content="${seo.description}" />`,
    `${seo.robots ? `<meta name="robots" content="${seo.robots}" />` : ''}`,
    `<link rel="canonical" href="${seo.url}" />`,
    `<meta property="og:title" content="${seo.title}" />`,
    `<meta property="og:description" content="${seo.description}" />`,
    `<meta property="og:url" content="${seo.url}" />`,
    `<meta property="og:type" content="${seo.type}" />`,
    `<meta property="og:image" content="${seo.image}" />`,
    `<meta name="twitter:card" content="${seo.twitterCard}" />`,
    `<meta name="twitter:title" content="${seo.title}" />`,
    `<meta name="twitter:description" content="${seo.description}" />`,
    `<meta name="twitter:image" content="${seo.image}" />`,
  ].filter(Boolean).join('\n    ')
}
