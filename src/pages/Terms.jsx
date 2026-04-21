import termsContent from '../../TERMS_AND_CONDITIONS_CONTENT.md?raw'
import BackButton from '../components/BackButton'

function renderTermsMarkdown(content) {
  return content
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (block.startsWith('# ')) {
        return (
          <h1 key={`h1-${index}`} className="terms-page__title">
            {block.slice(2)}
          </h1>
        )
      }

      if (block.startsWith('## ')) {
        return (
          <h2 key={`h2-${index}`} className="terms-page__section-title">
            {block.slice(3)}
          </h2>
        )
      }

      return (
        <p key={`p-${index}`} className="terms-page__paragraph">
          {block}
        </p>
      )
    })
}

export default function Terms() {
  return (
    <div className="terms-page">
      <main className="terms-page__main">
        <div className="terms-page__back-button-wrap">
          <BackButton />
        </div>
        <article aria-label="Terms and Conditions" className="terms-page__article">
          {renderTermsMarkdown(termsContent)}
        </article>
      </main>
    </div>
  )
}
