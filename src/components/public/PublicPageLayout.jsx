import PublicFooter from '../PublicFooter'
import '../../styles/public-page-layout.css'

export default function PublicPageLayout({ header, children, className = '' }) {
  return (
    <div className={`public-page-layout ${className}`.trim()}>
      {header ? <header className="public-page-layout__header">{header}</header> : null}
      <main className="public-page-main">{children}</main>
      <PublicFooter />
    </div>
  )
}
