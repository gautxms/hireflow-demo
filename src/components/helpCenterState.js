const HELP_ARTICLE_PARAM = 'helpArticle'

function toArticleId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function findArticleById(articlesByCategory, articleId) {
  const targetId = toArticleId(articleId)
  if (!targetId) {
    return null
  }

  for (const [categoryId, articles] of Object.entries(articlesByCategory)) {
    const article = articles.find((item) => item.id === targetId)
    if (article) {
      return { article, categoryId }
    }
  }

  return null
}

export function parseHelpCenterLocation(articlesByCategory, defaultCategory, locationLike) {
  const url = new URL(locationLike || 'https://example.com')
  const articleId = toArticleId(url.searchParams.get(HELP_ARTICLE_PARAM))
  const match = findArticleById(articlesByCategory, articleId)

  if (!match) {
    return { activeCategory: defaultCategory, selectedArticleId: null }
  }

  return { activeCategory: match.categoryId, selectedArticleId: match.article.id }
}

export function updateHelpCenterHistory(articleId, locationLike, { replace = false } = {}) {
  if (typeof window === 'undefined') {
    return null
  }

  const url = new URL(locationLike || window.location.href)
  const normalizedId = toArticleId(articleId)

  if (normalizedId) {
    url.searchParams.set(HELP_ARTICLE_PARAM, String(normalizedId))
  } else {
    url.searchParams.delete(HELP_ARTICLE_PARAM)
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`
  const method = replace ? 'replaceState' : 'pushState'
  window.history[method]({}, '', nextUrl)
  return nextUrl
}

export function filterHelpArticles(articles, searchQuery) {
  const query = String(searchQuery || '').trim().toLowerCase()

  if (!query) {
    return articles
  }

  return articles.filter((article) => (
    article.title.toLowerCase().includes(query)
    || article.desc.toLowerCase().includes(query)
  ))
}

export function resolveVisibleSelection(selectedArticleId, visibleArticles) {
  const normalizedId = toArticleId(selectedArticleId)
  if (!normalizedId) {
    return null
  }

  return visibleArticles.some((article) => article.id === normalizedId) ? normalizedId : null
}
