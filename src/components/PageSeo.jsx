import { useEffect } from 'react'
import { applySeoToDocument, resolvePageSeo } from '../seo/pageSeo'

export default function PageSeo({ pathname = '/', currentPage = null }) {
  useEffect(() => {
    const seo = resolvePageSeo({
      pathname,
      currentPage,
      siteUrl: window.location.origin,
    })

    applySeoToDocument(document, seo)
  }, [currentPage, pathname])

  return null
}
