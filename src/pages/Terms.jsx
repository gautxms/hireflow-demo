import termsContent from '../../TERMS_AND_CONDITIONS_CONTENT.md?raw'
import ContentDocument from '../components/ContentDocument'

function renderTermsMarkdown(content) {
  return content
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (block.startsWith('## ')) {
        return (
          <h2 key={`h2-${index}`} className="content-document__heading">
            {block.slice(3)}
          </h2>
        )
      }

      if (block.startsWith('- ')) {
        return (
          <ul key={`ul-${index}`} className="content-document__list">
            {block
              .split('\n')
              .map((item) => item.trim())
              .filter((item) => item.startsWith('- '))
              .map((item) => <li key={item}>{item.slice(2)}</li>)}
          </ul>
        )
      }

      return (
        <p key={`p-${index}`} className="content-document__paragraph">
          {block.replace(/^#\s+/, '')}
        </p>
      )
    })
}

export default function Terms() {
  return (
    <ContentDocument title="Terms and Conditions" eyebrow="Legal">
      {renderTermsMarkdown(termsContent)}
    </ContentDocument>
  )
}
