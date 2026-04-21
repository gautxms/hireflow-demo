import { useEffect } from 'react'

export default function usePageSeo(title, description, structuredData = null) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    let descriptionTag = document.querySelector('meta[name="description"]')
    const createdTag = !descriptionTag

    if (!descriptionTag) {
      descriptionTag = document.createElement('meta')
      descriptionTag.name = 'description'
      document.head.appendChild(descriptionTag)
    }

    const previousDescription = descriptionTag.getAttribute('content') || ''
    descriptionTag.setAttribute('content', description)

    return () => {
      document.title = previousTitle
      descriptionTag?.setAttribute('content', previousDescription)
      if (createdTag && descriptionTag?.parentNode) {
        descriptionTag.parentNode.removeChild(descriptionTag)
      }
    }
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
