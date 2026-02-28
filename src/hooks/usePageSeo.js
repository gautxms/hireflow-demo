import { useEffect } from 'react'

export default function usePageSeo(title, description) {
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
}
