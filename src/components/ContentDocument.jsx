import PublicPageLayout from './public/PublicPageLayout'
import BackButton from './BackButton'

export default function ContentDocument({ title, eyebrow = 'Information', backLabel = 'Back', children }) {
  return (
    <PublicPageLayout>
      <section className="public-section content-document">
        <div className="content-document__back"><BackButton label={backLabel} /></div>
        <article className="content-document__article" aria-label={title}>
          <p className="content-document__eyebrow">{eyebrow}</p>
          <h1 className="content-document__title">{title}</h1>
          <div className="content-document__body">{children}</div>
        </article>
      </section>
    </PublicPageLayout>
  )
}
