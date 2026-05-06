export const ANALYSES_PAGE_SIZE = 15

export function getAnalysesTotalPages(totalItems, pageSize = ANALYSES_PAGE_SIZE) {
  const safeTotalItems = Math.max(0, Number(totalItems) || 0)
  const safePageSize = Math.max(1, Number(pageSize) || ANALYSES_PAGE_SIZE)
  return Math.max(1, Math.ceil(safeTotalItems / safePageSize))
}

export function clampAnalysesPage(page, totalItems, pageSize = ANALYSES_PAGE_SIZE) {
  const totalPages = getAnalysesTotalPages(totalItems, pageSize)
  const normalizedPage = Math.max(1, Number(page) || 1)
  return Math.min(normalizedPage, totalPages)
}

export function paginateAnalyses(items, page, pageSize = ANALYSES_PAGE_SIZE) {
  const sourceItems = Array.isArray(items) ? items : []
  const nextPage = clampAnalysesPage(page, sourceItems.length, pageSize)
  const start = (nextPage - 1) * pageSize
  const rows = sourceItems.slice(start, start + pageSize)
  return {
    rows,
    pagination: {
      page: nextPage,
      totalPages: getAnalysesTotalPages(sourceItems.length, pageSize),
      shouldRenderControls: sourceItems.length > pageSize,
    },
  }
}
