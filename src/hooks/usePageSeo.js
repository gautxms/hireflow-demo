import { useEffect } from 'react'
import { applySeoToDocument, resolvePageSeo } from '../seo/pageSeo'

export default function usePageSeo(title, description, structuredData = null) {
  useEffect(() => {
    const seo = resolvePageSeo({ pathname: window.location.pathname, siteUrl: window.location.origin })

    applySeoToDocument(document, {
      ...seo,
      title: title || seo.title,
      description: description || seo.description,
    })
  }, [description, title])

  useEffect(() => {
    if (!structuredData) {
      return undefined
    }

    const scriptTag = document.createElement('script')
    scriptTag.type = 'application/ld+json'
    scriptTag.setAttribute('data-hireflow-seo', 'structured-data')
    scriptTag.text = JSON.stringify(structuredData)
    document.head.appendChild(scriptTag)

    return () => {
      if (scriptTag.parentNode) {
        scriptTag.parentNode.removeChild(scriptTag)
      }
    }
  }, [structuredData])
}
