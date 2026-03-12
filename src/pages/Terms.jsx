import usePageSeo from '../hooks/usePageSeo'
import termsContent from '../../TERMS_AND_CONDITIONS_CONTENT.md?raw'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function goBack() {
  navigate('/')
}

function renderTermsMarkdown(content) {
  return content
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (block.startsWith('# ')) {
        return (
          <h1 key={`h1-${index}`} style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', lineHeight: 1.2 }}>
            {block.slice(2)}
          </h1>
        )
      }

      if (block.startsWith('## ')) {
        return (
          <h2 key={`h2-${index}`} style={{ fontFamily: 'var(--font-display)', margin: '2rem 0 0.75rem' }}>
            {block.slice(3)}
          </h2>
        )
      }

      return (
        <p key={`p-${index}`} style={{ margin: 0 }}>
          {block}
        </p>
      )
    })
}

export default function Terms() {
  usePageSeo('HireFlow Terms of Service', 'Review the HireFlow Terms of Service for using our resume screening platform and related features.')

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.25rem', lineHeight: 1.75 }}>
        <button
          type="button"
          onClick={goBack}
          style={{
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--accent)',
            borderRadius: 8,
            padding: '0.55rem 0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '1.25rem',
          }}
        >
          ← Back
        </button>
        <article aria-label="Terms and Conditions">
          {renderTermsMarkdown(termsContent)}
        </article>
      </main>
    </div>
  )
}
