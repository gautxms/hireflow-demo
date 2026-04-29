import { useEffect } from 'react'
import { applySeoToDocument, resolvePageSeo } from '../seo/pageSeo'

export default function usePageSeo(title, description) {
  useEffect(() => {
    const seo = resolvePageSeo({ pathname: window.location.pathname, siteUrl: window.location.origin })

    applySeoToDocument(document, {
      ...seo,
      title: title || seo.title,
      description: description || seo.description,
    })
  }, [description, title])
}
